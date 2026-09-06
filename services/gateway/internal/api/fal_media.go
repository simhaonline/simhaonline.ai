// fal.ai media adapter (audit/Screenshot_16 follow-up): fal does not expose
// an OpenAI-style /v1/chat/completions endpoint — its native API is a
// synchronous model call at https://fal.run/<model-id>. Without this adapter
// every media request 404s and silently cools the account down.
//
// Translation contract (chat → fal → chat):
//   request  {"model":"fal-ai/flux/schnell","messages":[{"role":"user","content":"…"}]}
//   fal POST https://fal.run/fal-ai/flux/schnell  {"prompt":"…"}
//   response → OpenAI shape: {"choices":[{"message":{"role":"assistant","content":"![image](url)"}}]}
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// isFalAccount mirrors the store's provider detection.
func isFalAccount(providerName, baseURL string) bool {
	b := strings.ToLower(baseURL)
	return strings.EqualFold(providerName, "fal") ||
		strings.Contains(b, "api.fal.ai") || strings.Contains(b, "fal.run")
}

// falTaskFromModality decides what kind of generation was requested.
func falTaskFromModality(outputModality, task string) string {
	om := strings.ToLower(outputModality)
	t := strings.ToLower(task)
	switch {
	case strings.Contains(om, "video") || strings.Contains(t, "text-to-video"):
		return "video"
	case strings.Contains(om, "audio") || strings.Contains(om, "speech") || strings.Contains(t, "text-to-speech"):
		return "audio"
	case strings.Contains(om, "image") || strings.Contains(t, "text-to-image"):
		return "image"
	default:
		// model id heuristic: fal-ai/flux… = image, veo/kling/… = video
		return ""
	}
}

// lastUserText extracts the prompt for fal's flat payload.
func lastUserText(data map[string]any) string {
	if msgs, ok := data["messages"].([]any); ok {
		for i := len(msgs) - 1; i >= 0; i-- {
			if msg, ok := msgs[i].(map[string]any); ok {
				if role, _ := msg["role"].(string); role == "user" {
					if c, ok := msg["content"].(string); ok {
						return c
					}
				}
			}
		}
	}
	return ""
}

// guessFalKind from the model id when no explicit modality was provided.
func guessFalKind(model string) string {
	m := strings.ToLower(model)
	switch {
	case strings.Contains(m, "video") || strings.Contains(m, "veo") || strings.Contains(m, "kling") ||
		strings.Contains(m, "seedance") || strings.Contains(m, "wan-") || strings.Contains(m, "ltx"):
		return "video"
	case strings.Contains(m, "tts") || strings.Contains(m, "elevenlabs") || strings.Contains(m, "music") || strings.Contains(m, "suno"):
		return "audio"
	case strings.Contains(m, "flux") || strings.Contains(m, "image") || strings.Contains(m, "sdxl") ||
		strings.Contains(m, "stable") || strings.Contains(m, "imagen"):
		return "image"
	default:
		return ""
	}
}

// falGenerate performs the synchronous fal.run call and returns (url, mediaKind, err).
func falGenerate(ctx context.Context, httpClient *http.Client, authHeaders map[string]string, model, prompt string, kind string) (string, string, error) {
	if kind == "" {
		kind = guessFalKind(model)
	}
	payload := map[string]any{"prompt": prompt}
	body, _ := json.Marshal(payload)

	url := "https://fal.run/" + model
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", kind, err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range authHeaders {
		req.Header.Set(k, v)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", kind, err
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode >= 400 {
		return "", kind, fmt.Errorf("fal %d: %s", resp.StatusCode, truncate(string(raw), 300))
	}

	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", kind, fmt.Errorf("fal: undecodable response (%s)", truncate(string(raw), 200))
	}
	urlOut := falExtractURL(out, kind)
	if urlOut == "" {
		return "", kind, fmt.Errorf("fal: no media URL in response (%s)", truncate(string(raw), 200))
	}
	return urlOut, kind, nil
}

// falExtractURL hunts for the media URL across fal's per-model shapes.
func falExtractURL(out map[string]any, kind string) string {
	// direct fields used by flux/veo/tts families
	for _, key := range []string{"url", "audio_url", "video_url", "image_url"} {
		if v, ok := out[key].(string); ok && strings.HasPrefix(v, "http") {
			return v
		}
	}
	// nested objects: images:[{url}], videos:[{url}], audio:{url}
	for _, key := range []string{"images", "videos", "audio", "image", "video"} {
		v, ok := out[key]
		if !ok {
			continue
		}
		switch item := v.(type) {
		case []any:
			if len(item) > 0 {
				if first, ok := item[0].(map[string]any); ok {
					if u, ok := first["url"].(string); ok {
						return u
					}
				}
			}
		case map[string]any:
			if u, ok := item["url"].(string); ok {
				return u
			}
		case string:
			if strings.HasPrefix(item, "http") {
				return item
			}
		}
	}
	return ""
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// falChatResponse wraps a media URL in an OpenAI chat completion so existing
// clients (and the Workbench renderer) display it as markdown.
func falChatResponse(model, url, kind string, promptLen int) []byte {
	content := url
	switch kind {
	case "image":
		content = "![generated image](" + url + ")"
	case "video":
		content = "[generated video](" + url + ")"
	case "audio":
		content = "[generated audio](" + url + ")"
	}
	out := map[string]any{
		"id":      fmt.Sprintf("fal-%d", time.Now().UnixNano()),
		"object":  "chat.completion",
		"model":   model,
		"choices": []any{map[string]any{
			"index":         0,
			"message":       map[string]any{"role": "assistant", "content": content},
			"finish_reason": "stop",
		}},
		"usage": map[string]any{
			"prompt_tokens":     promptLen / 4,
			"completion_tokens": 10,
			"total_tokens":      promptLen/4 + 10,
		},
	}
	b, _ := json.Marshal(out)
	return b
}