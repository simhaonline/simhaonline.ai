-- Additive orchestration metadata. No existing account, key, chat, or usage
-- tables are changed. These tables describe capabilities and decisions made
-- by external API-backed providers; they do not pretend an adapter exists.

CREATE TABLE IF NOT EXISTS task_capabilities (
    slug TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    input_modalities TEXT[] NOT NULL DEFAULT ARRAY['text'],
    output_modalities TEXT[] NOT NULL DEFAULT ARRAY['text'],
    architecture_families TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    requirements_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_capabilities (
    account_name TEXT NOT NULL REFERENCES accounts(name) ON DELETE CASCADE,
    model TEXT NOT NULL,
    capability_slug TEXT NOT NULL REFERENCES task_capabilities(slug) ON DELETE CASCADE,
    input_modalities TEXT[] NOT NULL DEFAULT ARRAY['text'],
    output_modalities TEXT[] NOT NULL DEFAULT ARRAY['text'],
    quality_score NUMERIC(5,2),
    confidence_score NUMERIC(5,2),
    benchmark_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    latency_ms NUMERIC(12,2),
    cost_input_per_million NUMERIC(14,6),
    cost_output_per_million NUMERIC(14,6),
    context_tokens INTEGER,
    source TEXT NOT NULL DEFAULT 'discovery',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_verified_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (account_name, model, capability_slug)
);
CREATE INDEX IF NOT EXISTS idx_model_capabilities_task
    ON model_capabilities(capability_slug, enabled);

CREATE TABLE IF NOT EXISTS orchestration_profiles (
    id BIGSERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    quality_weight NUMERIC(5,4) NOT NULL DEFAULT 0.45,
    latency_weight NUMERIC(5,4) NOT NULL DEFAULT 0.25,
    cost_weight NUMERIC(5,4) NOT NULL DEFAULT 0.20,
    reliability_weight NUMERIC(5,4) NOT NULL DEFAULT 0.10,
    min_confidence NUMERIC(5,2) NOT NULL DEFAULT 70,
    fallback_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    safety_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO orchestration_profiles(name)
VALUES ('balanced')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS routing_decisions (
    id BIGSERIAL,
    request_id TEXT NOT NULL,
    client_key_id BIGINT REFERENCES client_api_keys(id) ON DELETE SET NULL,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    profile_id BIGINT REFERENCES orchestration_profiles(id) ON DELETE SET NULL,
    primary_task TEXT REFERENCES task_capabilities(slug) ON DELETE SET NULL,
    secondary_tasks TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    input_modalities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    output_modalities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    complexity_score NUMERIC(5,2),
    selected_account TEXT,
    selected_model TEXT,
    fallback_chain JSONB NOT NULL DEFAULT '[]'::jsonb,
    candidate_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
    justification TEXT,
    estimated_latency_ms NUMERIC(12,2),
    estimated_cost NUMERIC(14,8),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, created_at)
);
SELECT create_hypertable('routing_decisions', 'created_at', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_routing_decisions_request
    ON routing_decisions(request_id, created_at DESC);

CREATE TABLE IF NOT EXISTS judge_evaluations (
    id BIGSERIAL,
    routing_decision_id BIGINT,
    request_id TEXT NOT NULL,
    account_name TEXT,
    model TEXT,
    task_slug TEXT REFERENCES task_capabilities(slug) ON DELETE SET NULL,
    quality_score NUMERIC(5,2),
    factuality_score NUMERIC(5,2),
    safety_score NUMERIC(5,2),
    format_score NUMERIC(5,2),
    latency_score NUMERIC(5,2),
    cost_score NUMERIC(5,2),
    verdict TEXT,
    explanation TEXT,
    metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, created_at)
);
SELECT create_hypertable('judge_evaluations', 'created_at', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_judge_evaluations_request
    ON judge_evaluations(request_id, created_at DESC);

CREATE TABLE IF NOT EXISTS orchestration_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id TEXT UNIQUE NOT NULL,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    task_slug TEXT REFERENCES task_capabilities(slug) ON DELETE SET NULL,
    input_modality TEXT,
    output_modality TEXT,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','running','completed','failed','cancelled','needs_review')),
    input_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
    output_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
    options_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_orchestration_jobs_user_created
    ON orchestration_jobs(user_id, created_at DESC);

INSERT INTO task_capabilities(slug, display_name, input_modalities, output_modalities, architecture_families)
VALUES
 ('text-generation','Text Generation',ARRAY['text'],ARRAY['text'],ARRAY['decoder-only transformer','MoE']),
 ('text-classification','Text Classification',ARRAY['text'],ARRAY['label'],ARRAY['encoder transformer','CNN']),
 ('token-classification','Token Classification',ARRAY['text'],ARRAY['tokens','labels'],ARRAY['encoder transformer']),
 ('table-question-answering','Table Question Answering',ARRAY['text','table'],ARRAY['text','table'],ARRAY['encoder-decoder transformer']),
 ('question-answering','Question Answering',ARRAY['text'],ARRAY['text'],ARRAY['encoder-decoder transformer','RAG']),
 ('zero-shot-classification','Zero-Shot Classification',ARRAY['text'],ARRAY['label'],ARRAY['NLI transformer']),
 ('translation','Translation',ARRAY['text'],ARRAY['text'],ARRAY['encoder-decoder transformer']),
 ('summarization','Summarization',ARRAY['text'],ARRAY['text'],ARRAY['encoder-decoder transformer','RAG']),
 ('feature-extraction','Feature Extraction',ARRAY['text'],ARRAY['embedding'],ARRAY['encoder transformer']),
 ('fill-mask','Fill-Mask',ARRAY['text'],ARRAY['text'],ARRAY['masked-language transformer']),
 ('sentence-similarity','Sentence Similarity',ARRAY['text'],ARRAY['score','embedding'],ARRAY['encoder transformer']),
 ('text-ranking','Text Ranking',ARRAY['text'],ARRAY['ranked-list'],ARRAY['cross-encoder']),
 ('text-to-speech','Text-to-Speech',ARRAY['text'],ARRAY['audio'],ARRAY['speech synthesizer']),
 ('text-to-audio','Text-to-Audio',ARRAY['text'],ARRAY['audio'],ARRAY['diffusion','audio transformer']),
 ('automatic-speech-recognition','Automatic Speech Recognition',ARRAY['audio'],ARRAY['text'],ARRAY['Whisper encoder-decoder']),
 ('audio-to-audio','Audio-to-Audio',ARRAY['audio'],ARRAY['audio'],ARRAY['audio transformer','diffusion']),
 ('audio-classification','Audio Classification',ARRAY['audio'],ARRAY['label'],ARRAY['audio transformer','CNN']),
 ('voice-activity-detection','Voice Activity Detection',ARRAY['audio'],ARRAY['segments'],ARRAY['CNN','RNN/LSTM']),
 ('image-text-to-text','Image-Text-to-Text',ARRAY['image','text'],ARRAY['text'],ARRAY['vision-language transformer']),
 ('image-text-to-image','Image-Text-to-Image',ARRAY['image','text'],ARRAY['image'],ARRAY['diffusion']),
 ('image-text-to-video','Image-Text-to-Video',ARRAY['image','text'],ARRAY['video'],ARRAY['diffusion transformer']),
 ('visual-question-answering','Visual Question Answering',ARRAY['image','text'],ARRAY['text'],ARRAY['vision-language transformer']),
 ('document-question-answering','Document Question Answering',ARRAY['document','image','text'],ARRAY['text'],ARRAY['OCR','layout transformer','RAG']),
 ('video-text-to-text','Video-Text-to-Text',ARRAY['video','text'],ARRAY['text'],ARRAY['video transformer','vision-language transformer']),
 ('visual-document-retrieval','Visual Document Retrieval',ARRAY['image','document','text'],ARRAY['ranked-list','embedding'],ARRAY['CLIP','RAG']),
 ('any-to-any','Any-to-Any',ARRAY['text','image','audio','video'],ARRAY['text','image','audio','video'],ARRAY['multimodal transformer']),
 ('depth-estimation','Depth Estimation',ARRAY['image'],ARRAY['depth-map'],ARRAY['ViT','CNN']),
 ('image-classification','Image Classification',ARRAY['image'],ARRAY['label'],ARRAY['ViT','CNN']),
 ('object-detection','Object Detection',ARRAY['image'],ARRAY['objects'],ARRAY['YOLO','DETR']),
 ('image-segmentation','Image Segmentation',ARRAY['image'],ARRAY['mask'],ARRAY['SAM','ViT']),
 ('text-to-image','Text-to-Image',ARRAY['text'],ARRAY['image'],ARRAY['diffusion','DiT']),
 ('image-to-text','Image-to-Text',ARRAY['image'],ARRAY['text'],ARRAY['vision-language transformer']),
 ('image-to-image','Image-to-Image',ARRAY['image'],ARRAY['image'],ARRAY['diffusion']),
 ('image-to-video','Image-to-Video',ARRAY['image'],ARRAY['video'],ARRAY['diffusion transformer']),
 ('unconditional-image-generation','Unconditional Image Generation',ARRAY['noise'],ARRAY['image'],ARRAY['diffusion','GAN']),
 ('video-classification','Video Classification',ARRAY['video'],ARRAY['label'],ARRAY['video transformer']),
 ('text-to-video','Text-to-Video',ARRAY['text'],ARRAY['video'],ARRAY['diffusion transformer']),
 ('zero-shot-image-classification','Zero-Shot Image Classification',ARRAY['image','text'],ARRAY['label'],ARRAY['CLIP']),
 ('mask-generation','Mask Generation',ARRAY['image','text'],ARRAY['mask'],ARRAY['SAM']),
 ('zero-shot-object-detection','Zero-Shot Object Detection',ARRAY['image','text'],ARRAY['objects'],ARRAY['Grounding DINO','OWL-ViT']),
 ('text-to-3d','Text-to-3D',ARRAY['text'],ARRAY['3d'],ARRAY['diffusion','NeRF']),
 ('image-to-3d','Image-to-3D',ARRAY['image'],ARRAY['3d'],ARRAY['NeRF','Gaussian Splatting']),
 ('image-feature-extraction','Image Feature Extraction',ARRAY['image'],ARRAY['embedding'],ARRAY['ViT','CLIP']),
 ('keypoint-detection','Keypoint Detection',ARRAY['image'],ARRAY['keypoints'],ARRAY['CNN','ViT']),
 ('video-to-video','Video-to-Video',ARRAY['video'],ARRAY['video'],ARRAY['diffusion','video transformer']),
 ('tabular-classification','Tabular Classification',ARRAY['table'],ARRAY['label'],ARRAY['gradient boosting','tabular transformer']),
 ('tabular-regression','Tabular Regression',ARRAY['table'],ARRAY['number'],ARRAY['gradient boosting','tabular transformer']),
 ('time-series-forecasting','Time Series Forecasting',ARRAY['time-series'],ARRAY['time-series'],ARRAY['time-series transformer','LSTM']),
 ('reinforcement-learning','Reinforcement Learning',ARRAY['state','action'],ARRAY['policy'],ARRAY['decision transformer','PPO','SAC']),
 ('robotics','Robotics',ARRAY['sensor','state','image'],ARRAY['action','trajectory'],ARRAY['vision-language-action','policy transformer']),
 ('graph-machine-learning','Graph Machine Learning',ARRAY['graph'],ARRAY['embedding','label','score'],ARRAY['GNN','GraphSAGE','GAT'])
ON CONFLICT (slug) DO UPDATE SET
 display_name=EXCLUDED.display_name,
 input_modalities=EXCLUDED.input_modalities,
 output_modalities=EXCLUDED.output_modalities,
 architecture_families=EXCLUDED.architecture_families,
 updated_at=now();
