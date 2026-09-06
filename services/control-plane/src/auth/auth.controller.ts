import { Controller, Post, Get, Req, Res, Body, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';

const COOKIE = 'simha_session';

function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 24 * 3600 * 1000,
    domain: process.env.SESSION_COOKIE_DOMAIN || '.simhaonline.ai',
    path: '/',
  });
}

function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip).digest('hex');
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly mfa: MfaService) {}

  @Post('auth/login')
  async login(@Body() body: { email?: string; password?: string; mfa_code?: string }, @Res() res: Response) {
    const email = (body.email || '').toLowerCase().trim();
    const password = body.password || '';
    let userId: number | null;
    try {
      userId = await this.auth.verifyPassword(email, password);
    } catch (err: unknown) {
      const lockoutSeconds = (err as { lockoutSeconds?: number })?.lockoutSeconds;
      if (lockoutSeconds) {
        res.setHeader('Retry-After', String(lockoutSeconds));
        throw new HttpException(
          { error: `Account locked — try again in ${Math.ceil(lockoutSeconds / 60)} minutes` },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw err;
    }
    if (!userId) {
      throw new HttpException({ error: 'Invalid email or password' }, HttpStatus.UNAUTHORIZED);
    }
    // unverified accounts cannot sign in (audit v2 🔴 verification gate)
    if (!(await this.auth.emailVerified(userId))) {
      throw new HttpException(
        { error: 'Verify your email address before signing in — check your inbox for the confirmation link.' },
        HttpStatus.FORBIDDEN,
      );
    }
    // audit.md M6: TOTP second factor when enrolled
    if (await this.mfa.isEnabled(userId)) {
      const code = String(body.mfa_code || '').trim();
      if (!code) {
        throw new HttpException(
          { error: 'Enter your 6-digit authenticator code', code: 'mfa_required' },
          HttpStatus.UNAUTHORIZED,
        );
      }
      if (!(await this.mfa.verifySecondFactor(userId, code))) {
        throw new HttpException({ error: 'Invalid authenticator code' }, HttpStatus.UNAUTHORIZED);
      }
    }
    const token = await this.auth.createSession(userId);
    setSessionCookie(res, token);
    return res.json({ ok: true });
  }

  @Post('auth/signup')
  async signup(
    @Body()
    body: {
      email?: string;
      password?: string;
      terms_accepted?: boolean;
      privacy_accepted?: boolean;
      marketing_email?: boolean;
    },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const email = (body.email || '').toLowerCase().trim();
    const password = body.password || '';
    if (!body.terms_accepted || !body.privacy_accepted) {
      throw new HttpException(
        { error: 'You must accept the Terms of Use and Privacy Policy' },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new HttpException({ error: 'Enter a valid email address' }, HttpStatus.BAD_REQUEST);
    }
    if (password.length < 10) {
      throw new HttpException(
        { error: 'Password must contain at least 10 characters' },
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      // per-IP + per-email signup throttle (audit v2 🔴 signup abuse)
      if (!(await this.auth.signupThrottleOk(hashIp(req.ip || ''), email))) {
        throw new HttpException(
          { error: 'Too many signup attempts — try again later' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const userId = await this.auth.createUser(email, password, 'operator', {
        terms_accepted: true,
        privacy_accepted: true,
        marketing_email: !!body.marketing_email,
        ip_hash: hashIp(req.ip || ''),
        accepted_at: new Date().toISOString(),
      });
      // email verification: account stays unverified until token consumed.
      const verifyToken = await this.auth.createAuthToken(userId, 'email_verify', 1440);
      const verifyUrl = `https://platform.simhaonline.ai/verify-email?token=${verifyToken}`;
      void this.auth.sendEmail(
        'Verify your Simha Edge Router account',
        email,
        `Confirm your account: ${verifyUrl}\nThe link expires in 24 hours.`,
      );
      void this.auth.sendEmail(
        'New Simha Edge Router signup',
        process.env.ADMIN_EMAIL || 'admin@simhaonline.ai',
        `A new operator account was created for ${email} (unverified).`,
      );
      // Session is issued but the account cannot route until verified;
      // login of unverified users is blocked (see auth/login) and the
      // workbench shows a verification prompt via /auth/me.
      const token = await this.auth.createSession(userId);
      setSessionCookie(res, token);
      return res.status(HttpStatus.CREATED).json({ ok: true, verification_required: true });
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        throw new HttpException(
          { error: 'An account with this email already exists' },
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }

  @Get('auth/me')
  async me(@Req() req: Request, @Res() res: Response) {
    const user = await this.auth.sessionUser(req.cookies?.[COOKIE]);
    if (!user) {
      throw new HttpException({ error: 'Authentication required' }, HttpStatus.UNAUTHORIZED);
    }
    const email_verified = await this.auth.emailVerified(user.id);
    return res.json({ ...user, email_verified });
  }

  @Post('auth/logout')
  async logout(@Req() req: Request, @Res() res: Response) {
    await this.auth.destroySession(req.cookies?.[COOKIE]);
    res.clearCookie(COOKIE, {
      domain: process.env.SESSION_COOKIE_DOMAIN || '.simhaonline.ai',
      path: '/',
    });
    return res.json({ ok: true });
  }

  // ── audit v2 🔴: account recovery + verification endpoints ─────────────────

  /** Confirm an email-verification token (from the signup email link). */
  @Post('auth/verify-email')
  async verifyEmail(@Body() body: { token?: string }, @Res() res: Response) {
    const token = String(body.token || '').trim();
    if (!token) throw new HttpException({ error: 'token required' }, HttpStatus.BAD_REQUEST);
    const userId = await this.auth.consumeAuthToken(token, 'email_verify');
    if (!userId) throw new HttpException({ error: 'Invalid or expired verification link' }, HttpStatus.BAD_REQUEST);
    await this.auth.markEmailVerified(userId);
    return res.json({ ok: true, verified: true });
  }

  /** Resend the verification email (throttled via the same token table). */
  @Post('auth/resend-verification')
  async resendVerification(@Req() req: Request, @Res() res: Response) {
    const user = await this.auth.sessionUser(req.cookies?.[COOKIE]);
    if (!user) throw new HttpException({ error: 'Authentication required' }, HttpStatus.UNAUTHORIZED);
    if (await this.auth.emailVerified(user.id)) return res.json({ ok: true, already_verified: true });
    const verifyToken = await this.auth.createAuthToken(user.id, 'email_verify', 1440);
    const verifyUrl = `https://platform.simhaonline.ai/verify-email?token=${verifyToken}`;
    void this.auth.sendEmail(
      'Verify your Simha Edge Router account',
      user.email,
      `Confirm your account: ${verifyUrl}\nThe link expires in 24 hours.`,
    );
    return res.json({ ok: true, resent: true });
  }

  /** Request a password-reset link. Always 202 — never reveals account existence. */
  @Post('auth/forgot-password')
  async forgotPassword(@Req() req: Request, @Res() res: Response, @Body() body: { email?: string }) {
    const email = (body.email || '').toLowerCase().trim();
    if (!email) throw new HttpException({ error: 'email required' }, HttpStatus.BAD_REQUEST);
    const userId = await this.auth.findUserByEmail(email);
    if (userId) {
      const resetToken = await this.auth.createAuthToken(userId, 'password_reset', 30);
      const resetUrl = `https://platform.simhaonline.ai/reset-password?token=${resetToken}`;
      void this.auth.sendEmail(
        'Reset your Simha Edge Router password',
        email,
        `Reset your password: ${resetUrl}\nThe link expires in 30 minutes. If you did not request this, ignore this email.`,
      );
    }
    return res.status(HttpStatus.ACCEPTED).json({ ok: true });
  }

  /** Consume a reset token and set the new password (sessions revoked). */
  @Post('auth/reset-password')
  async resetPassword(@Body() body: { token?: string; password?: string }, @Res() res: Response) {
    const token = String(body.token || '').trim();
    const password = String(body.password || '');
    if (!token) throw new HttpException({ error: 'token required' }, HttpStatus.BAD_REQUEST);
    const userId = await this.auth.consumeAuthToken(token, 'password_reset');
    if (!userId) throw new HttpException({ error: 'Invalid or expired reset link' }, HttpStatus.BAD_REQUEST);
    try {
      await this.auth.setPassword(userId, password);
    } catch (err: unknown) {
      throw new HttpException({ error: (err as Error).message || 'invalid password' }, HttpStatus.BAD_REQUEST);
    }
    return res.json({ ok: true, password_changed: true });
  }

  /** Change password while signed in (requires the current password). */
  @Post('auth/change-password')
  async changePassword(@Req() req: Request, @Res() res: Response,
                       @Body() body: { current_password?: string; new_password?: string }) {
    const user = await this.auth.sessionUser(req.cookies?.[COOKIE]);
    if (!user) throw new HttpException({ error: 'Authentication required' }, HttpStatus.UNAUTHORIZED);
    const verified = await this.auth.verifyPassword(user.email, String(body.current_password || ''));
    if (!verified || verified !== user.id) {
      throw new HttpException({ error: 'Current password is incorrect' }, HttpStatus.UNAUTHORIZED);
    }
    try {
      await this.auth.setPassword(user.id, String(body.new_password || ''));
    } catch (err: unknown) {
      throw new HttpException({ error: (err as Error).message || 'invalid password' }, HttpStatus.BAD_REQUEST);
    }
    return res.json({ ok: true, password_changed: true });
  }

  // ── audit.md M6: TOTP two-factor management (session required) ──────────────

  @Get('auth/mfa/status')
  async mfaStatus(@Req() req: Request, @Res() res: Response) {
    const user = await this.auth.sessionUser(req.cookies?.[COOKIE]);
    if (!user) throw new HttpException({ error: 'Authentication required' }, HttpStatus.UNAUTHORIZED);
    return res.json({ enabled: await this.mfa.isEnabled(user.id) });
  }

  /** Step 1: generate secret + otpauth URL (scan with Google Authenticator). */
  @Post('auth/mfa/enroll')
  async mfaEnroll(@Req() req: Request, @Res() res: Response) {
    const user = await this.auth.sessionUser(req.cookies?.[COOKIE]);
    if (!user) throw new HttpException({ error: 'Authentication required' }, HttpStatus.UNAUTHORIZED);
    if (await this.mfa.isEnabled(user.id)) {
      throw new HttpException({ error: '2FA is already enabled' }, HttpStatus.CONFLICT);
    }
    const { secret, otpauth_url } = await this.mfa.beginEnrollment(user.id, user.email);
    return res.json({ ok: true, secret, otpauth_url });
  }

  /** Step 2: confirm with the first code; returns recovery codes once. */
  @Post('auth/mfa/confirm')
  async mfaConfirm(@Req() req: Request, @Res() res: Response, @Body() body: { code?: string }) {
    const user = await this.auth.sessionUser(req.cookies?.[COOKIE]);
    if (!user) throw new HttpException({ error: 'Authentication required' }, HttpStatus.UNAUTHORIZED);
    const result = await this.mfa.confirmEnrollment(user.id, String(body.code || ''));
    if (!result.ok) throw new HttpException({ error: result.error }, HttpStatus.BAD_REQUEST);
    return res.json({ ok: true, recovery_codes: result.recovery_codes });
  }

  @Post('auth/mfa/disable')
  async mfaDisable(@Req() req: Request, @Res() res: Response, @Body() body: { code?: string }) {
    const user = await this.auth.sessionUser(req.cookies?.[COOKIE]);
    if (!user) throw new HttpException({ error: 'Authentication required' }, HttpStatus.UNAUTHORIZED);
    const result = await this.mfa.disable(user.id, String(body.code || ''));
    if (!result.ok) throw new HttpException({ error: result.error }, HttpStatus.BAD_REQUEST);
    return res.json({ ok: true, disabled: true });
  }
}