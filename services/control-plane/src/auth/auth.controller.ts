import { Controller, Post, Get, Req, Res, Body, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { AuthService } from './auth.service';

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
  constructor(private readonly auth: AuthService) {}

  @Post('auth/login')
  async login(@Body() body: { email?: string; password?: string }, @Res() res: Response) {
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
      const userId = await this.auth.createUser(email, password, 'operator', {
        terms_accepted: true,
        privacy_accepted: true,
        marketing_email: !!body.marketing_email,
        ip_hash: hashIp(req.ip || ''),
        accepted_at: new Date().toISOString(),
      });
      void this.auth.sendEmail(
        'Welcome to Simha Edge Router',
        email,
        'Your Simha Edge Router operator account has been created. Sign in at https://platform.simhaonline.ai/login',
      );
      void this.auth.sendEmail(
        'New Simha Edge Router signup',
        process.env.ADMIN_EMAIL || 'admin@simhaonline.ai',
        `A new operator account was created for ${email}.`,
      );
      const token = await this.auth.createSession(userId);
      setSessionCookie(res, token);
      return res.status(HttpStatus.CREATED).json({ ok: true });
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
    return res.json(user);
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
}