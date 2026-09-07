// Multi-provider media adapters (audit follow-up: "we have other image,
// video & audio models from different providers"). The fal adapter covers
// fal.ai; this file adds:
//   · Qwen Cloud (DashScope multimodal-generation native API) — qwen-image,
//     wan2.7-image, qwen TTS families
//   · OpenAI Images API (/v1/images/generations) — gpt-image-1/2, chatgpt-image
//   · OpenAI chat-native image models (gpt-4o image_generation) → chat API
// Each returns (mediaURL, kind, err) so the forward loop wraps them in a
// chat completion exactly like the fal path.
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/simhaonline/gateway/internal/store"
)

// qwenIs detects DashScope accounts.
func qwenIs(baseURL string) bool {
	return strings.Contains(strings.ToLower(baseURL), "dashscope")
}

// openaiIs detects OpenAI accounts.
func openaiIs(providerName, baseURL string) bool {
	return strings.EqualFold(providerName, "openai") ||
		strings.Contains(strings.ToLower(baseURL), "api.openai.com")
}

// dashscopeGenerate calls the DashScope multimodal-generation endpoint.
// Image models take messages[{content:[{text}]}]; TTS models take
// input:{text, voice}. Returns the first media URL.
func dashscopeGenerate(ctx context.Context, httpClient *http.Client, apiKey, model, prompt string, kind string) (string, error) {
	input := map[string]any{}
	if kind == "audio" {
		input["text"] = prompt
		input["voice"] = "Cherry"
	} else {
		input["messages"] = []map[string]any{{
			"role": "user",
			"content": []map[string]any{
				{"type": "text", "text": prompt},
			},
		}}
	}
	payload := map[string]any{"model": model, "input": input}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
		bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("dashscope %d: %s", resp.StatusCode, truncate(string(raw), 300))
	}
	var out struct {
		Output struct {
			Choices []struct {
				Message struct {
					Content []map[string]any `json:"content"`
				} `json:"message"`
			} `json:"choices"`
			Audio struct {
				URL string `json:"url"`
			} `json:"audio"`
		} `json:"output"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("dashscope: undecodable (%s)", truncate(string(raw), 200))
	}
	if out.Output.Audio.URL != "" {
		return out.Output.Audio.URL, nil
	}
	for _, choice := range out.Output.Choices {
		for _, part := range choice.Message.Content {
			for _, key := range []string{"image", "audio", "video"} {
				if u, ok := part[key].(string); ok && strings.HasPrefix(u, "http") {
					return u, nil
				}
			}
		}
	}
	return "", fmt.Errorf("dashscope: no media URL (%s)", truncate(string(raw), 200))
}

// openaiImagesGenerate calls /v1/images/generations (gpt-image-1/2, dall-e).
// Returns the first b64 or URL result as a data-URI-safe markdown payload.
func openaiImagesGenerate(ctx context.Context, httpClient *http.Client, apiKey, model, prompt, aspect string) (string, string, error) {
	size := "1024x1024"
	switch aspect {
	case "9:16", "3:4":
		size = "1024x1536" // portrait (gpt-image family supports 1024x1024/1024x1536/1536x1024)
	case "16:9", "4:3":
		size = "1536x1024"
	}
	payload := map[string]any{"model": model, "prompt": prompt, "n": 1, "size": size}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.openai.com/v1/images/generations", bytes.NewReader(body))
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 12<<20))
	if resp.StatusCode >= 400 {
		return "", "", fmt.Errorf("openai-images %d: %s", resp.StatusCode, truncate(string(raw), 300))
	}
	var out struct {
		Data []struct {
			URL     string `json:"url"`
			B64JSON string `json:"b64_json"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", "", fmt.Errorf("openai-images: undecodable (%s)", truncate(string(raw), 200))
	}
	if len(out.Data) == 0 {
		return "", "", fmt.Errorf("openai-images: empty data")
	}
	if out.Data[0].URL != "" {
		return out.Data[0].URL, "image", nil
	}
	if out.Data[0].B64JSON != "" {
		return "data:image/png;base64," + out.Data[0].B64JSON, "image", nil
	}
	return "", "", fmt.Errorf("openai-images: no image in response")
}

// pickMediaAdapter decides which adapter serves this account+model and runs it.
// Returns (url, kind, err).
func pickMediaAdapter(ctx context.Context, st *store.Store, acc *store.Account, model, prompt, kind, aspect string, durationSec int) (string, string, error) {
	switch {
	case isFalAccount(acc.ProviderName(), acc.BaseURL):
		return falGenerate(ctx, st.HTTPClient(), st.UpstreamAuthHeaders(ctx, acc), model, prompt, kind, aspect, durationSec)
	case qwenIs(acc.BaseURL):
		url, err := dashscopeGenerate(ctx, st.HTTPClient(), st.UpstreamAPIKey(ctx, acc), model, prompt, kind)
		return url, kind, err
	case openaiIs(acc.ProviderName(), acc.BaseURL) && (strings.Contains(model, "image") || strings.Contains(model, "dall")):
		return openaiImagesGenerate(ctx, st.HTTPClient(), st.UpstreamAPIKey(ctx, acc), model, prompt, aspect)
	default:
		// unknown provider media shape — let the caller fall back to the
		// plain OpenAI proxy (chat-completions), which handles
		// native-multimodal models like Gemini image / Seedream via TokenRouter.
		return "", "", errNoMediaAdapter
	}
}

var errNoMediaAdapter = fmt.Errorf("no media adapter for provider")