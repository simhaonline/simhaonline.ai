# MASTER ENGINEERING PROMPT

## SIMHA ONLINE AI — Production-Grade Expansion of Existing AI Chat, Router & Agent Platform

You are a **Principal AI Platform Architect, Staff Backend Engineer, Distributed Systems Engineer, AI Routing Researcher, Security Engineer, DevOps/SRE Engineer, Data Engineer and Senior Frontend Architect**.

Your task is to **inspect, understand, preserve, harden and extend the EXISTING `simhaonline.ai` AI Chat & Router project**.

This is an **UPDATE OF AN EXISTING PRODUCTION CODEBASE**.

It is NOT a greenfield rewrite.

Do not replace the current architecture simply because you prefer another framework.

Do not delete, rename or restructure working components without a demonstrated technical necessity.

Do not break any currently functioning API, database schema, frontend route, provider integration, authentication mechanism, user configuration, model configuration, chat history, agent, tool, plugin, MCP integration, billing/accounting feature or deployment process.

The fundamental rule is:

> **PRESERVE CORE. EXTEND THROUGH ISOLATED ENGINES.**

---

# 1. PRIMARY OBJECTIVE

Transform the existing `simhaonline.ai` AI Chat & Router into a modular, production-grade **AI Intelligence, Routing, Agent, Knowledge, Evaluation and Automation Platform** while maintaining backward compatibility.

The platform should ultimately be capable of acting as:

* AI Chat platform
* Universal LLM Router
* OpenAI-compatible gateway
* Anthropic-compatible gateway
* Model registry
* Provider registry
* Agent runtime
* Multi-agent orchestration system
* Skills registry
* Plugins registry
* MCP registry/client/server
* Tool execution platform
* Web intelligence platform
* AI ecosystem discovery engine
* Knowledge ingestion platform
* Memory system
* Vector retrieval system
* Model evaluation platform
* Human preference arena
* LLM-as-a-Judge platform
* Routing optimization engine
* Local lightweight LLM runtime
* Code/project intelligence system
* Website intelligence system
* AI media generation pipeline
* Observability and tracing system
* Cost/account/quota/token governance platform
* Administrative control plane

All newly introduced capabilities must be **modular and independently disableable**.

---

# 2. NON-NEGOTIABLE FIRST STEP — AUDIT BEFORE CODING

Before modifying anything, recursively inspect the complete current repository.

Identify and document:

* application architecture
* languages
* frameworks
* package managers
* frontend architecture
* backend architecture
* API layers
* proxy/router layers
* model abstraction
* provider abstraction
* authentication
* authorization
* database architecture
* migrations
* Redis/Valkey/cache use
* vector database use
* queues/workers
* websocket/SSE implementation
* background jobs
* cron jobs
* agents
* tools
* skills
* MCP integration
* plugin architecture
* file handling
* document ingestion
* embeddings
* RAG
* model discovery
* health checks
* configuration
* secret management
* logging
* tracing
* metrics
* billing
* token accounting
* admin dashboard
* user dashboard
* API key management
* deployment
* Docker
* Docker Compose
* Kubernetes
* CI/CD
* tests
* documentation

Produce an internal:

`CURRENT_ARCHITECTURE_AUDIT.md`

before implementing major changes.

Do NOT blindly generate an entirely new project.

---

# 3. STRICT ZERO-REGRESSION REQUIREMENT

The current application must remain functional throughout the upgrade.

Implement new modules behind:

* feature flags
* service interfaces
* adapters
* internal APIs
* independent processes
* worker services
* sidecars where appropriate

Never tightly couple experimental engines into the request-critical chat path.

Examples:

```text
SIMHA Core
    |
    +-- Existing Router
    +-- Existing Chat
    +-- Existing Auth
    +-- Existing Providers
    |
    +-- New Optional Engines
          |
          +-- Discovery Engine
          +-- Scraping Engine
          +-- Reverse Intelligence Engine
          +-- Routing Intelligence Engine
          +-- Ranking Engine
          +-- Judge Engine
          +-- Agent Engine
          +-- Team Engine
          +-- Memory Engine
          +-- DataLake Engine
          +-- Local LLM Engine
          +-- Media Engine
          +-- Observability Engine
```

If an optional engine crashes, existing chat and routing MUST continue functioning.

---

# 4. IMPLEMENTATION LANGUAGE POLICY

Use:

### Go

Prefer Go for:

* high-throughput gateway functions
* provider health checking
* concurrency-heavy services
* crawling scheduler
* rate limiting
* routing
* streaming
* queue consumers
* telemetry pipeline
* network-facing APIs

### Python

Prefer Python for:

* ML
* ranking
* LLM evaluation
* embeddings
* semantic analysis
* code intelligence
* crawling intelligence
* agent orchestration
* media workflows
* RAG
* experimentation

Do NOT force everything into one language.

Each isolated service must expose a stable internal contract.

Preferred contracts:

* REST
* gRPC
* async events
* Redis Streams / Valkey Streams
* NATS
* another existing broker if already part of the project

Do not add unnecessary infrastructure merely because it is fashionable.

---

# 5. PROPOSED ENGINE LAYOUT

Adapt to the existing repository instead of blindly forcing these paths.

Recommended structure:

```text
engines/
├── discovery-engine/
├── scraping-engine/
├── reverse-intelligence/
├── route-intelligence/
├── arena-engine/
├── judge-engine/
├── agent-runtime/
├── team-orchestrator/
├── memory-palace/
├── knowledge-runtime/
├── local-llm/
├── media-engine/
└── telemetry-engine/

services/
├── registry-service/
├── scheduler-service/
├── worker-service/
└── gateway-adapters/

contracts/
├── openapi/
├── grpc/
├── events/
└── schemas/
```

Every engine requires:

```text
README.md
ARCHITECTURE.md
API.md
config.example.*
Dockerfile
healthcheck
tests/
migrations/ where necessary
```

---

# 6. AI ECOSYSTEM DISCOVERY ENGINE

Create an independent:

`AI Discovery Engine`

Its purpose is to continuously discover, normalize, verify and update information about the modern AI ecosystem.

Track entities including:

* AI models
* LLMs
* multimodal models
* embedding models
* rerankers
* image models
* video models
* audio models
* speech models
* coding models
* reasoning models

And:

* agents
* agent frameworks
* skills
* plugins
* tools
* MCP servers
* MCP clients
* MCP registries
* APIs
* AI gateways
* AI routers
* vector databases
* inference engines
* model providers
* AI IDEs
* coding agents
* evaluation frameworks
* prompt tools
* observability platforms

Sources can include, where legally and technically permissible:

* GitHub
* GitLab
* official documentation
* official product websites
* package registries
* PyPI
* npm
* crates.io
* Go modules
* Docker registries
* Hugging Face
* MCP registries
* vendor model catalogues
* official changelogs
* release feeds
* RSS/Atom

Store:

* canonical name
* aliases
* description
* category
* homepage
* repository
* license
* owner
* latest version
* release date
* last checked
* last changed
* documentation URL
* supported protocols
* API compatibility
* capabilities
* dependencies
* runtime
* install method
* model/provider compatibility
* stars
* forks
* activity
* security status if known
* source confidence
* source provenance

Never allow scraped claims to silently become trusted platform configuration.

Implement:

```text
discovered
→ parsed
→ normalized
→ deduplicated
→ verified
→ approved
→ active
```

---

# 7. ADVANCED SCRAPING ENGINE

Create an independent scraping/crawling service inspired by modern adaptive crawling systems.

Do NOT vendor or directly integrate Scrapling.

Implement your own clean abstraction.

Capabilities:

## HTTP Fetching

* GET
* HEAD
* POST where explicitly allowed
* persistent sessions
* cookies
* redirect handling
* compression
* HTTP/2 where supported
* connection pooling
* retry policy
* timeout policy

## Dynamic Browser Rendering

Optional:

* Chromium
* Playwright
* CDP

Use only when static HTTP extraction is insufficient.

## Adaptive Crawling

Support:

* concurrent crawling
* per-host concurrency
* crawl delay
* rate limit
* retry
* backoff
* pause
* resume
* checkpointing
* crawl queues
* priority URLs
* URL canonicalization
* duplicate prevention
* crawl depth
* domain restrictions
* robots policy
* sitemap discovery

## Extraction

Support:

* CSS
* XPath
* semantic blocks
* JSON-LD
* OpenGraph
* metadata
* headings
* tables
* lists
* links
* code blocks
* article content
* Markdown conversion
* structured JSON extraction

Create adaptive selector recovery based on features such as:

* DOM path
* attributes
* neighboring elements
* semantic text
* relative position

Do not intentionally bypass access controls, authentication restrictions, CAPTCHAs or anti-bot protections where doing so would violate site terms or authorization.

## LLM-Safe Content

Before supplying crawled pages to models:

* strip executable scripts
* remove hidden content where appropriate
* isolate untrusted instructions
* mark web content as untrusted
* remove obvious prompt injection patterns
* preserve source URL
* preserve retrieval timestamp
* calculate content hash

---

# 8. SOURCE CHANGE DETECTION

Do not reprocess unchanged content.

For every fetched resource calculate:

* raw hash
* normalized hash
* semantic fingerprint
* ETag
* Last-Modified
* retrieved timestamp

Pipeline:

```text
FETCH
 ↓
NORMALIZE
 ↓
HASH
 ↓
COMPARE
 ↓
UNCHANGED → STOP
 ↓
CHANGED
 ↓
DIFF
 ↓
EXTRACT
 ↓
VERIFY
 ↓
UPDATE
```

Maintain version history.

---

# 9. REVERSE INTELLIGENCE ENGINE

Create an independent:

`Reverse Intelligence Engine`

It must analyze authorized/local/publicly accessible projects and websites to derive architecture and technical intelligence.

This is NOT intended to bypass authorization controls, recover secrets or defeat software protections.

## Repository Intelligence

Analyze:

* directory tree
* architecture
* modules
* packages
* imports
* dependencies
* APIs
* classes
* functions
* interfaces
* schemas
* database models
* environment requirements
* Docker
* compose
* Kubernetes
* CI/CD
* tests
* documentation
* config
* build system
* entry points

Create:

* module graph
* package graph
* API graph
* dependency graph
* service graph
* database map
* call relationships where practical

## Website Intelligence

Analyze publicly accessible website assets and metadata:

* routes
* static resources
* scripts
* frameworks
* APIs explicitly exposed to the browser
* public metadata
* page hierarchy
* structured data
* publicly visible network architecture

Do NOT:

* attempt credential theft
* extract private keys
* defeat authentication
* exploit vulnerabilities
* attack third-party infrastructure

## Outputs

Generate:

```text
PROJECT_PROFILE.json
ARCHITECTURE.md
DEPENDENCY_GRAPH.json
API_MAP.json
TECH_STACK.json
SECURITY_OBSERVATIONS.md
RECOMMENDATIONS.md
```

---

# 10. ROUTING INTELLIGENCE ENGINE

Create a separate:

`Simha Route Intelligence Engine`

This augments but DOES NOT replace the current production router until explicitly enabled.

Its objective is to continuously determine the most appropriate provider/model path using:

* quality
* latency
* cost
* availability
* quota
* context
* capability
* user preference
* geographic restrictions
* provider limits
* task type
* historical performance

---

# 11. PROVIDER POOL DEDUPLICATION

Different gateways frequently expose the same underlying model.

Normalize aliases:

```text
GPT alias A
GPT alias B
Vendor alias
OpenRouter alias
Cloud marketplace alias
```

into a canonical model identity.

Maintain:

```text
canonical_model
provider
provider_model_id
endpoint
region
pricing
limits
context_window
features
health
latency
quota
```

Prevent redundant retries across aliases ultimately backed by the same failing provider infrastructure when detectable.

---

# 12. PROVIDER CREDIT/TIER ENGINE

Maintain a provider/account tier state:

```text
FREE
TRIAL
PROMOTIONAL
CREDIT
PREPAID
PAYG
SUBSCRIPTION
ENTERPRISE
LOCAL
UNKNOWN
```

Track:

* free requests
* credit balance
* reset time
* expiration
* rate limits
* daily limits
* monthly limits
* RPM
* TPM
* concurrency
* account status

Routing policies should support:

```text
free-first
quality-first
latency-first
cost-first
local-first
privacy-first
balanced
custom
```

---

# 13. PROVIDER TERMS & CAPABILITY NORMALIZER

Build structured provider metadata.

Never let an LLM autonomously accept legal terms.

Extract/document:

* model IDs
* context
* output limits
* modalities
* tool calling
* streaming
* structured output
* JSON mode
* embeddings
* audio
* vision
* reasoning
* caching
* retention terms
* rate limits
* data usage statements
* regional restrictions
* commercial-use notes
* pricing

Store source provenance and verification timestamp.

---

# 14. UNIVERSAL MODEL CAPABILITY REGISTRY

For every model store:

```text
model_id
canonical_name
provider
family
version
release_date

text
vision
audio_input
audio_output
video
files

tools
parallel_tools
json
structured_output

reasoning
coding
agentic
browser
computer_use

context_window
max_output_tokens

input_price
output_price
cached_input_price

latency_p50
latency_p95
availability
quality_score
arena_score
judge_score
user_score
```

Missing information should remain UNKNOWN rather than being invented.

---

# 15. INTELLIGENT ROUTING

Implement configurable scoring.

Example:

```text
route_score =
    quality_weight       * quality
  + judge_weight         * judge_score
  + user_weight          * user_preference
  + reliability_weight   * availability
  + latency_weight       * latency_score
  + cost_weight          * cost_score
  + quota_weight         * quota_health
  + capability_weight    * task_match
  + context_weight       * context_fit
```

Make all weights configurable.

---

# 16. TASK CLASSIFICATION

Before routing, classify requests into one or more categories:

* conversation
* reasoning
* coding
* debugging
* mathematics
* research
* search
* summarization
* extraction
* translation
* vision
* document
* image generation
* video
* audio
* tool use
* agent task
* long-context
* structured output

Classification must be cheap.

Possible strategies:

1. heuristics
2. local classifier
3. lightweight model
4. embedding classifier
5. LLM classifier only as fallback

---

# 17. MODEL CASCADE

Support cascaded execution:

```text
Local Small Model
      ↓ insufficient confidence
Cheap Cloud Model
      ↓
High Quality Model
      ↓
Reasoning Model
```

Escalation triggers may include:

* low confidence
* schema validation failure
* tool failure
* judge failure
* user quality tier
* task difficulty

---

# 18. CIRCUIT BREAKERS

Per provider/model:

```text
CLOSED
OPEN
HALF_OPEN
```

Track:

* request errors
* timeouts
* 429
* 5xx
* malformed streams
* invalid responses
* latency degradation

Do not repeatedly send traffic to known unhealthy endpoints.

---

# 19. ARENA RANKING ENGINE

Create an independent:

`SIMHA Arena`

Do not directly integrate external arena repositories.

Implement scientifically defensible preference ranking including:

* Bradley-Terry
* Elo-style views if desired
* bootstrap confidence intervals
* pairwise win rates
* tie handling
* confidence
* minimum sample requirements
* category-specific rankings
* time-window rankings

Maintain:

* current ranking
* daily snapshots
* weekly snapshots
* monthly snapshots
* all-time history

---

# 20. BLIND MODEL BATTLES

Implement anonymous comparisons:

```text
Prompt
   ↓
Model A
Model B
   ↓
Randomized presentation
   ↓
User selects:
A
B
Tie
Both bad
```

Do not reveal the models until after voting where blind mode is enabled.

Prevent bias from response ordering by randomizing left/right placement.

---

# 21. RANKING SEGMENTS

Support leaderboard categories:

* overall
* coding
* reasoning
* mathematics
* research
* instruction following
* creative writing
* multilingual
* long context
* tool use
* agentic
* vision
* speed
* price/performance
* local models
* small models

---

# 22. LLM JUDGE ENGINE

Create:

`Simha Judge`

independent from the production chat path.

Support:

## Pairwise Judge

```text
PROMPT
RESPONSE A
RESPONSE B
```

## Single Response Judge

Assess one answer against a rubric.

## Multi-Judge

Use multiple independent judges when configured.

Example:

```text
Judge A
Judge B
Judge C
   ↓
Consensus/Aggregator
```

---

# 23. JUDGING DIMENSIONS

Support configurable criteria:

* correctness
* relevance
* instruction following
* completeness
* reasoning quality
* factuality
* clarity
* safety
* citation quality
* code quality
* efficiency
* hallucination risk
* tool-use quality

Never expose hidden chain-of-thought as a required evaluation artifact.

Judges should evaluate observable output and, where appropriate, concise rationale.

---

# 24. ANTI-JUDGE-BIAS

Mitigate:

* position bias
* verbosity bias
* provider favoritism
* model-name bias
* self-preference bias

Techniques:

* anonymization
* random order
* reverse-order duplicate judging
* multiple judges
* calibration sets
* confidence scoring

---

# 25. ROUTER + ARENA + JUDGE FEEDBACK LOOP

These engines should collectively improve routing.

```text
User Request
      ↓
Router
      ↓
Model
      ↓
Response
      ↓
User feedback + Arena + Judge + Telemetry
      ↓
Performance Store
      ↓
Routing Intelligence
```

Do NOT allow one judge result to immediately modify global production routing.

Require:

* minimum observations
* confidence
* decay
* administrator policy
* optional approval

---

# 26. MULTI-AGENT TEAM ENGINE

Create:

`SIMHA Team Engine`

Purpose:

Collaborative execution through specialized agents.

Capabilities:

* role-based agents
* task planning
* decomposition
* delegation
* shared workspace
* shared memory
* artifact passing
* dependency graph
* parallel execution
* sequential execution
* hierarchical teams
* voting
* critic/reviewer
* retry
* human approval gates

Example:

```text
Supervisor
 ├── Researcher
 ├── Architect
 ├── Developer
 ├── Tester
 ├── Security Reviewer
 └── Final Reviewer
```

---

# 27. AGENT DEFINITION

Each agent should have structured metadata:

```yaml
id:
name:
description:
role:
system_policy:
preferred_models:
fallback_models:
skills:
tools:
mcp_servers:
memory_scope:
permissions:
max_steps:
max_tokens:
timeout:
approval_requirements:
```

---

# 28. WORKFLOW DAG

Represent multi-step work as a DAG.

Example:

```text
Research
   ↓
Architecture
   ↓
Implementation
   ↓
Testing
   ↓
Security Review
   ↓
Final Review
```

Allow parallel branches where dependencies permit.

Persist workflow state so jobs can resume after restart.

---

# 29. SHARED TEAM WORKSPACE

Provide scoped team state containing:

* task
* plan
* discoveries
* intermediate results
* artifacts
* decisions
* citations
* errors
* unresolved questions

Do not continuously resend full history to every model.

Use selective context retrieval.

---

# 30. AUTONOMOUS AGENT RUNTIME

Create a general agent runtime inspired by modern autonomous-agent frameworks, but implement it natively.

Core loop:

```text
GOAL
 ↓
PLAN
 ↓
SELECT TOOL
 ↓
EXECUTE
 ↓
OBSERVE
 ↓
UPDATE STATE
 ↓
CONTINUE / RETRY / ESCALATE
 ↓
VERIFY
 ↓
ANSWER
```

Support:

* filesystem tools
* code execution sandbox
* browser tools
* web retrieval
* APIs
* MCP
* database tools
* search
* document tools
* user-defined skills

Security is mandatory.

---

# 31. TOOL PERMISSION SYSTEM

Every tool should declare:

```text
READ
WRITE
NETWORK
SHELL
DATABASE
FILESYSTEM
EMAIL
BROWSER
ADMIN
EXTERNAL_SIDE_EFFECT
```

Agents receive only explicitly authorized capabilities.

Require stronger approval for:

* deletion
* credential changes
* external communication
* payments
* infrastructure mutations
* destructive database operations

---

# 32. SKILL REGISTRY

Build a native Skills registry.

Each skill:

```yaml
name:
version:
description:
instructions:
tools:
requirements:
permissions:
compatible_agents:
compatible_models:
source:
author:
checksum:
trusted:
enabled:
```

Support:

* install
* enable
* disable
* update
* version
* test
* rollback

Never execute newly scraped community skills automatically.

---

# 33. PLUGIN REGISTRY

Create normalized plugin records:

```text
id
name
version
provider
source
runtime
permissions
authentication
tools
capabilities
health
status
trust_level
```

Treat third-party plugins as untrusted until approved.

---

# 34. MCP CONTROL PLANE

Build a centralized MCP registry supporting:

* stdio
* HTTP
* SSE/streamable transport as appropriate
* enabled/disabled state
* tool discovery
* resource discovery
* prompt discovery
* health
* latency
* authentication
* scopes
* per-user policy
* per-agent policy
* audit logs

Never allow arbitrary discovered MCP servers to run automatically.

---

# 35. MEMORY PALACE ENGINE

Create a standalone long-term memory system.

Do not merely dump every conversation into vectors.

Implement memory types:

```text
working
episodic
semantic
procedural
entity
relationship
project
user-approved
agent
team
```

---

# 36. MEMORY OBJECT

Example:

```json
{
  "memory_id": "",
  "scope": "",
  "type": "",
  "subject": "",
  "content": "",
  "embedding_ref": "",
  "source": "",
  "importance": 0,
  "confidence": 0,
  "created_at": "",
  "last_accessed": "",
  "expires_at": null,
  "relationships": []
}
```

---

# 37. ASSOCIATIVE MEMORY GRAPH

Support relationships:

```text
PERSON
PROJECT
ORGANIZATION
MODEL
PROVIDER
AGENT
DOCUMENT
TOPIC
DECISION
TASK
```

Edges can include:

```text
OWNS
USES
RELATED_TO
DEPENDS_ON
PREFERS
CREATED
MENTIONED_IN
SUPERSEDES
CONTRADICTS
```

Allow combined retrieval:

```text
vector similarity
+
graph proximity
+
importance
+
recency
+
task relevance
```

---

# 38. MEMORY PALACES / SPACES

Logical memory spaces:

```text
Personal
Projects
Coding
Research
Business
Agents
Models
Providers
Customers
Custom
```

Spaces are logical namespaces, not necessarily a visual 3D UI.

---

# 39. MEMORY GOVERNANCE

Support:

* inspect
* edit
* delete
* expire
* pin
* export
* clear by scope

Never persist:

* raw passwords
* API secrets
* private keys
* authentication tokens

unless an explicitly designed encrypted secret store requires them.

---

# 40. AI DATA RUNTIME / KNOWLEDGE ENGINE

Create a separate knowledge layer inspired by modern AI datalakes/vector runtimes.

Do not tightly couple core chat to one vendor.

Implement adapters.

Support:

* documents
* text
* code
* images metadata
* audio metadata
* video metadata
* embeddings
* chunks
* datasets
* crawl results
* agent artifacts
* evaluation records

Capabilities:

* versioning
* metadata filtering
* semantic retrieval
* hybrid retrieval
* streaming ingestion
* deduplication
* snapshots
* lineage
* dataset versions

Possible backends, selected according to current architecture:

* PostgreSQL + pgvector
* Qdrant
* Milvus
* SQLite vector for edge/local
* object storage

Do not introduce all simultaneously without justification.

---

# 41. LOCAL LIGHTWEIGHT LLM ENGINE

Create a standalone local model runtime.

The objective is not necessarily to reproduce PicoLM's implementation language or source, but to provide comparable system capabilities:

* compact inference
* GGUF-compatible runtime where feasible
* CPU inference
* low RAM usage
* quantized models
* streaming
* deterministic generation
* JSON constrained output
* local privacy
* offline operation
* local classifier
* routing helper
* summarizer
* intent classifier
* agent helper

Prefer battle-tested runtime adapters where permitted rather than writing unsafe tensor kernels merely to imitate another project.

Possible adapters:

* llama.cpp-compatible server
* Ollama
* MLX where applicable
* local OpenAI-compatible inference servers

Keep Simha's local abstraction independent of those backends.

---

# 42. LOCAL MODEL ROUTING

Use small local models for inexpensive tasks:

* intent classification
* message categorization
* simple extraction
* metadata normalization
* routing classification
* query rewriting
* lightweight summarization
* safety prechecks where appropriate

Do not use tiny models for tasks exceeding demonstrated capability.

---

# 43. MEDIA GENERATION ENGINE

Create an independent:

`SIMHA Media Engine`

Support multi-stage AI media workflows.

Pipelines:

```text
text → script
script → storyboard
storyboard → assets
assets → narration
assets + narration → timeline
timeline → subtitles
timeline → render
render → QA
```

---

# 44. MEDIA SOURCES

Create provider adapters for:

* image generation
* video generation
* TTS
* music
* stock media where licensed
* user-uploaded media

Do not hard-code one provider.

---

# 45. VIDEO MONTAGE

Support:

* image sequences
* clips
* narration
* music
* transitions
* text
* subtitles
* title cards
* outro
* branding
* aspect-ratio conversion

Formats:

```text
16:9
9:16
1:1
4:5
custom
```

Use FFmpeg or another established rendering layer.

---

# 46. MEDIA PIPELINE MANIFEST

Represent projects declaratively.

Example:

```yaml
project:
  title:
  aspect_ratio: "9:16"
  fps: 30

scenes:
  - id: scene_001
    duration:
    narration:
    visual:
    music:
    subtitle:
```

Allow resume/re-render from a failed stage rather than regenerating everything.

---

# 47. MEDIA QA

Before marking a video complete verify:

* playable file
* correct duration
* audio stream
* video stream
* subtitle timing
* silence
* clipping
* black frames where detectable
* resolution
* aspect ratio
* output size

---

# 48. OBSERVABILITY ENGINE

Create a native:

`SIMHA Telemetry`

Do not attempt to reproduce unrelated application functionality merely due to a referenced repository name.

Implement proper AI-workflow observability.

Capture:

```text
trace_id
request_id
session_id
user_id
agent_id
team_id
workflow_id
provider
model
endpoint
tool
MCP server
latency
tokens
cost
status
error
retry
cache_hit
route_reason
judge_score
```

---

# 49. DISTRIBUTED TRACING

Trace:

```text
User Request
   ↓
Gateway
   ↓
Router
   ↓
Provider
   ↓
Tool
   ↓
Agent
   ↓
Judge
   ↓
Final
```

Implement OpenTelemetry-compatible tracing where appropriate.

Never log:

* passwords
* API secrets
* bearer tokens
* raw credentials

Implement redaction.

---

# 50. COST INTELLIGENCE

Track per request:

```text
input tokens
output tokens
cached tokens
provider cost
estimated cost
latency
model
provider
account
```

Aggregate by:

* user
* model
* provider
* API key
* project
* agent
* team
* day
* week
* month

---

# 51. SEMANTIC CACHE

Create optional cache based on:

```text
exact hash
normalized prompt
semantic similarity
model family
system prompt
tool context
freshness
```

Never return cached answers for clearly time-sensitive requests unless freshness policy permits it.

Track:

* cache hits
* misses
* token savings
* cost savings

---

# 52. PROVIDER ACCOUNT MANAGEMENT

The admin panel should support multiple accounts per provider.

Example:

```text
Provider
 ├── Account A
 ├── Account B
 └── Account C
```

Track each account separately:

* status
* health
* credits
* limits
* last error
* requests
* tokens
* cost

API secrets must be encrypted at rest or stored in the project's approved secret manager.

---

# 53. ADMIN CONTROL CENTER

Extend the existing dashboard rather than replacing it unnecessarily.

Suggested navigation:

```text
Overview

AI
├── Chat
├── Models
├── Providers
├── Router
├── Local Models
└── Model Registry

Intelligence
├── Discovery
├── Scrapers
├── Sources
├── Projects
└── Reverse Analysis

Agents
├── Agents
├── Teams
├── Workflows
├── Skills
├── Tools
├── Plugins
└── MCP

Knowledge
├── Memory
├── Knowledge Base
├── Vectors
├── Datasets
└── Crawl Index

Evaluation
├── Arena
├── Leaderboards
├── Judges
├── Benchmarks
└── Feedback

Media
├── Projects
├── Assets
├── Pipelines
└── Renders

Operations
├── Requests
├── Tokens
├── Costs
├── Cache
├── Traces
├── Logs
├── Queues
├── Health
└── Alerts

System
├── Users
├── API Keys
├── RBAC
├── Settings
├── Feature Flags
└── Audit Logs
```

---

# 54. MAIN OVERVIEW DASHBOARD

Include useful operational cards:

```text
Requests Today
Active Users
Active Providers
Healthy Providers
Models Available
Agents Running
Workflows Running
Crawl Jobs
Queue Depth
Average Latency
P95 Latency
Tokens Today
Cost Today
Cache Savings
Error Rate
```

Charts:

* traffic by provider
* traffic by model
* token usage
* cost
* latency
* success rate
* fallback rate
* cache hit rate
* judge quality
* arena movement
* agent executions

---

# 55. ROUTING DEBUGGER

For every request administrators should be able to inspect:

```text
Prompt classification

Candidates:
Model A — rejected: no vision
Model B — rejected: quota exhausted
Model C — score 0.84
Model D — score 0.81

Selected:
Model C

Fallback:
Model D
```

Make routing explainable.

---

# 56. WEB INTELLIGENCE UI

Provide:

* sources
* source status
* crawl schedule
* last crawl
* changed pages
* errors
* discovered links
* extracted entities
* diff history
* crawl statistics

---

# 57. REVERSE ANALYSIS UI

Allow authorized users to submit:

* Git repository URL
* local project
* uploaded archive
* website

Return:

* architecture
* dependency map
* technology
* endpoints
* components
* recommendations
* generated diagrams

---

# 58. ARENA UI

Build polished side-by-side battle experience.

Features:

* blind A/B
* markdown
* code highlighting
* streaming
* vote buttons
* tie
* both bad
* reveal after vote
* leaderboard update

---

# 59. MEMORY UI

Allow viewing memories as:

* list
* timeline
* entity graph
* palace/space
* source
* agent
* project

Provide search and deletion controls.

---

# 60. DATABASE DESIGN

Do NOT put everything into one giant table.

Suggested logical domains:

```text
providers
provider_accounts
models
model_aliases
model_capabilities
model_pricing
model_health

requests
usage
costs
routing_decisions

agents
agent_runs
teams
team_runs
workflows
workflow_steps

tools
skills
plugins
mcp_servers

crawl_sources
crawl_jobs
crawl_pages
crawl_versions
discovered_entities

projects
project_analysis

arena_battles
arena_votes
arena_rankings
ranking_snapshots

judge_runs
judge_scores

memories
memory_embeddings
memory_entities
memory_edges

documents
chunks
datasets
dataset_versions

media_projects
media_assets
media_jobs
media_renders

traces
audit_events
```

Use the current database wherever appropriate.

Add migrations safely.

Do not destroy existing data.

---

# 61. API DESIGN

Internal engines should have versioned APIs.

Examples:

```text
/api/v1/discovery/*
/api/v1/scrape/*
/api/v1/reverse/*
/api/v1/router/*
/api/v1/arena/*
/api/v1/judge/*
/api/v1/agents/*
/api/v1/teams/*
/api/v1/memory/*
/api/v1/knowledge/*
/api/v1/media/*
/api/v1/telemetry/*
```

Existing public APIs must remain backward compatible.

---

# 62. EVENT ARCHITECTURE

For long-running operations use jobs/events instead of blocking HTTP requests.

Example:

```text
crawl.requested
crawl.started
crawl.completed

source.changed

model.health.changed

agent.started
agent.completed

judge.completed

ranking.updated

memory.created

media.render.started
media.render.completed
```

Events require stable schemas and versioning.

---

# 63. JOB SYSTEM

Long-running work must support:

```text
QUEUED
RUNNING
PAUSED
COMPLETED
FAILED
CANCELLED
RETRYING
```

Persist:

* progress
* attempts
* errors
* timestamps
* artifacts

Support safe restart after process crashes.

---

# 64. SECURITY

Implement defense in depth.

Required:

* RBAC
* least privilege
* API-key scopes
* encrypted secrets
* input validation
* output escaping
* SSRF protection
* URL allow/deny policy
* DNS rebinding defense where appropriate
* file-type validation
* upload-size limits
* archive bomb protection
* path traversal protection
* shell isolation
* code execution sandbox
* network policies
* rate limits
* CSRF protections where relevant
* audit logs
* secure headers

---

# 65. SCRAPER SECURITY

Protect internal infrastructure.

Never allow user-submitted URLs to access:

```text
localhost
127.0.0.0/8
::1
169.254.0.0/16
private RFC1918 ranges
cloud metadata endpoints
internal service networks
```

unless explicitly authorized by an administrator for a private deployment.

Resolve DNS and validate the resolved destination before connecting.

Revalidate on redirects.

---

# 66. AGENT SANDBOX

Code execution must run in isolation.

Use one or more:

* containers
* namespaces
* seccomp
* AppArmor
* firejail
* gVisor
* microVM

depending on current deployment requirements.

Implement:

* CPU limit
* RAM limit
* storage quota
* wall-clock timeout
* process limit
* network policy

---

# 67. PROMPT INJECTION DEFENSE

Data coming from:

* web
* documents
* plugins
* MCP
* tools
* scraped repositories

is UNTRUSTED CONTENT.

It must never automatically override:

* system policy
* agent permissions
* tool permissions
* router policy
* security policy

Separate:

```text
trusted instructions
from
untrusted retrieved content
```

---

# 68. MULTI-TENANCY

Where the existing product supports multiple users/organizations, enforce tenant isolation for:

* chats
* memory
* documents
* vectors
* API keys
* agent runs
* crawl jobs
* datasets
* arena private data
* traces

Never depend only on frontend filters.

Enforce tenant scope server-side.

---

# 69. FEATURE FLAGS

Every major new engine needs an enable/disable control.

Example:

```text
discovery.enabled
scraper.enabled
reverse.enabled
route_intelligence.enabled
arena.enabled
judge.enabled
agents.enabled
teams.enabled
memory.enabled
knowledge.enabled
local_llm.enabled
media.enabled
telemetry.enabled
```

Default experimental engines to OFF where deployment risk exists.

---

# 70. FAILSAFE BEHAVIOR

If a new service is down:

* chat still works
* current router still works
* authentication still works
* existing models still work

Examples:

Arena failure → no effect on generation.

Judge failure → deliver generation without judge enrichment unless policy explicitly requires judging.

Memory failure → continue without retrieved memory.

Discovery failure → existing registry remains available.

---

# 71. TESTING REQUIREMENTS

Every module requires:

* unit tests
* integration tests
* API contract tests
* migration tests
* regression tests
* failure tests

Critical router additionally requires:

* concurrency tests
* fallback tests
* streaming tests
* provider timeout tests
* circuit breaker tests

Security-sensitive services require appropriate fuzz/property tests.

---

# 72. EXISTING FUNCTIONALITY REGRESSION SUITE

Before modifications create a baseline test suite covering existing:

* login
* registration if applicable
* chat
* streaming
* models
* providers
* routing
* OpenAI compatibility
* Anthropic compatibility where available
* tool calling
* files
* history
* settings
* API keys
* dashboard

Run this baseline after every major phase.

---

# 73. PERFORMANCE TESTS

Measure:

* requests/sec
* time to first token
* end-to-end latency
* P50
* P95
* P99
* router overhead
* memory overhead
* semantic-cache overhead
* crawler throughput
* queue throughput

Do not claim performance improvements without measurements.

---

# 74. ROUTER PERFORMANCE TARGET

The intelligence layer should add minimal latency.

For simple requests avoid:

```text
multiple expensive LLM classification calls
+
judge call
+
memory call
+
discovery lookup
```

before selecting a model.

Build a fast path.

---

# 75. DEPLOYMENT

Each independent service should support containerized deployment.

Potential composition:

```text
simha-core
simha-web
simha-worker
simha-scraper
simha-discovery
simha-reverse
simha-router-intelligence
simha-arena
simha-judge
simha-agent
simha-memory
simha-local-llm
simha-media
```

But consolidate services where operational simplicity outweighs separation.

Logical isolation is mandatory.

Excessive microservices are NOT mandatory.

---

# 76. HEALTH ENDPOINTS

Each engine should expose:

```text
/health/live
/health/ready
/metrics
```

Readiness must verify required dependencies.

---

# 77. OBSERVABILITY

Use structured logs.

Recommended:

* OpenTelemetry
* Prometheus-compatible metrics
* tracing
* existing logging stack

Do not require a completely new observability stack if one already exists.

---

# 78. CONFIGURATION

Centralize non-secret application configuration.

Support:

* environment variables
* existing config mechanism
* database settings
* admin dashboard

Secrets must NOT be placed into source-controlled config.

---

# 79. DOCUMENTATION

Generate:

```text
docs/
├── ARCHITECTURE.md
├── DEPLOYMENT.md
├── SECURITY.md
├── ROUTING.md
├── PROVIDERS.md
├── SCRAPER.md
├── DISCOVERY.md
├── REVERSE.md
├── ARENA.md
├── JUDGE.md
├── AGENTS.md
├── TEAMS.md
├── SKILLS.md
├── MCP.md
├── MEMORY.md
├── KNOWLEDGE.md
├── LOCAL_LLM.md
├── MEDIA.md
├── OBSERVABILITY.md
└── API.md
```

---

# 80. CLEAN-ROOM / EXTERNAL PROJECT POLICY

The external projects mentioned in this specification are **research/reference points only**.

DO NOT:

* copy proprietary code
* blindly copy repository structure
* vendor full source trees
* import repositories directly into Simha
* copy branding
* reproduce protected assets
* create runtime dependencies solely to reproduce another product

Instead:

1. study publicly documented capabilities
2. identify general architectural principles
3. design native SIMHA interfaces
4. independently implement needed functionality
5. document architectural decisions

Review licenses before incorporating any third-party package.

Maintain:

`THIRD_PARTY_NOTICES.md`

and dependency/license inventory.

---

# 81. PHASED IMPLEMENTATION

Do NOT implement everything in one giant uncontrolled change.

## Phase 0 — Baseline

* audit
* architecture map
* tests
* backup
* dependency inventory
* deployment baseline

## Phase 1 — Platform Contracts

* engine interfaces
* event schemas
* feature flags
* health
* shared auth
* service authentication
* RBAC

## Phase 2 — Intelligence

* scraping
* discovery
* normalization
* source versioning

## Phase 3 — Routing

* registry normalization
* provider pools
* account tiers
* health
* routing score
* circuit breakers

## Phase 4 — Evaluation

* arena
* judge
* feedback
* rankings

## Phase 5 — Agents

* agent runtime
* skills
* tools
* MCP
* multi-agent teams

## Phase 6 — Memory/Knowledge

* memory
* vectors
* graph
* knowledge runtime
* datasets

## Phase 7 — Reverse Intelligence

* project analysis
* website analysis
* architecture extraction

## Phase 8 — Local AI

* lightweight inference adapter
* local task classifiers
* local-first routing

## Phase 9 — Media

* asset pipeline
* storyboard
* rendering
* QA

## Phase 10 — Operations

* telemetry
* dashboards
* alerts
* cost intelligence
* hardening

---

# 82. DEVELOPMENT RULE — COMPLETE EACH PHASE

For every phase:

```text
Inspect
→ Design
→ Implement
→ Test
→ Run existing regression suite
→ Fix
→ Document
→ Commit logically
→ Continue
```

Never leave hundreds of TODO placeholders pretending the implementation is complete.

---

# 83. REQUIRED DATABASE MIGRATION POLICY

Before migrations:

* inspect existing schema
* create backup instructions
* create forward migration
* create rollback where feasible
* test existing data
* avoid destructive operations

Production migration should follow expand-and-contract patterns where required.

---

# 84. API BACKWARD COMPATIBILITY

Existing endpoints must retain:

* request format
* response format
* expected HTTP statuses
* streaming semantics

Where a breaking improvement is unavoidable, create a new API version instead.

---

# 85. UI DESIGN QUALITY

The dashboard must be production quality.

Use the existing UI system and design language where possible.

Requirements:

* responsive
* fast
* dark/light support if existing application supports it
* clear loading state
* error state
* empty state
* pagination
* filtering
* searching
* sorting
* virtualized large tables where needed

Do not generate a generic template dashboard disconnected from backend functionality.

---

# 86. ROUTING POLICY BUILDER

Admin UI should allow policy construction.

Example:

```text
Policy: Coding Premium

Task:
coding

Preferred:
best coding model

Max cost:
$0.05/request

Fallback:
Model B
Model C

Local fallback:
enabled

Judge:
sample 5%

Cache:
enabled
```

---

# 87. PROVIDER PRIORITY

Allow administrator-defined tiers:

```text
Tier 1
Tier 2
Tier 3
Disabled
```

But dynamic health and capabilities must still influence final selection.

---

# 88. MODEL OVERRIDE

Users/admins may explicitly select a model.

Explicit user selection should normally bypass automatic model choice while still applying:

* health checks
* authorization
* quota
* safety
* required capability validation

---

# 89. AUTO MODE

Provide:

`Auto / SIMHA Smart Route`

The system chooses the most appropriate model/provider according to routing policy.

The user can inspect the selected model where product policy allows it.

---

# 90. FALLBACK TRANSPARENCY

Record:

```text
requested model
actual model
requested provider
actual provider
fallback reason
```

Never silently pretend an unavailable requested model produced the response.

---

# 91. TOKEN ACCOUNTING

Normalize provider usage reporting.

Handle:

* prompt tokens
* completion tokens
* cached tokens
* reasoning tokens where exposed
* image units
* audio seconds
* video seconds
* provider-specific billing units

Store raw provider usage separately from normalized usage.

---

# 92. PRICING VERSION HISTORY

Model pricing changes.

Store:

```text
effective_from
effective_to
input_price
output_price
cache_price
source
```

Historical request cost calculations should use pricing applicable at execution time.

---

# 93. SOURCE TRUST MODEL

Each discovered source gets a trust category:

```text
OFFICIAL
VERIFIED
COMMUNITY
UNKNOWN
BLOCKED
```

Critical model/provider configuration should prefer official sources.

---

# 94. DATA PROVENANCE

Every automatically discovered field should support:

```text
value
source_url
retrieved_at
confidence
extractor
verification_status
```

Allow admins to see where information came from.

---

# 95. DUPLICATE ENTITY RESOLUTION

The same model/tool/agent can have many names.

Implement:

* canonical ID
* aliases
* fuzzy matching
* repository matching
* domain matching
* provider matching
* human merge
* human split

Never irreversibly merge uncertain identities.

---

# 96. AI-ASSISTED NORMALIZATION

LLMs may help normalize messy scraped metadata.

However:

LLM output is a proposal.

It does not become authoritative without deterministic validation and source provenance.

---

# 97. CHANGE REVIEW

When discovery detects important changes:

Example:

```text
Model context changed
Pricing changed
Provider deprecated model
New model released
MCP server version updated
Tool permissions changed
```

Surface them in:

`Pending Updates`

Admins can:

```text
Approve
Reject
Ignore
Auto-approve by rule
```

---

# 98. SECURITY REVIEW OF DISCOVERED COMPONENTS

Before activating external:

* MCP server
* plugin
* skill
* executable tool

inspect:

* source
* package
* declared permissions
* network requirements
* filesystem requirements
* install scripts
* suspicious commands
* license

Do not automatically run internet-discovered code.

---

# 99. COST-AWARE AGENTS

Agent workflows can consume substantial tokens.

Implement budgets:

```text
max_steps
max_tokens
max_cost
max_runtime
max_tool_calls
```

Stop or request escalation when limits are reached.

---

# 100. LOOP PROTECTION

Detect:

* repeating agent action
* repeated identical tool calls
* repeated failures
* repeated URLs
* cyclic delegation
* runaway retries

Terminate safely.

---

# 101. CONTEXT MANAGEMENT

Do not resend the entire conversation or workflow history every step.

Implement context selection:

```text
system
current task
recent messages
relevant memory
relevant artifacts
tool results
summary
```

Track token budget before provider invocation.

---

# 102. CONTEXT COMPACTION

When context approaches limits:

* summarize old turns
* preserve decisions
* preserve unresolved requirements
* preserve tool state
* preserve source references

Never silently drop critical constraints.

---

# 103. PROVIDER ADAPTER CONTRACT

Every LLM provider adapter should normalize methods such as:

```text
chat()
stream()
models()
health()
usage()
capabilities()
```

Optional:

```text
embeddings()
images()
audio()
video()
files()
batches()
```

Adapter capability discovery must drive behavior.

---

# 104. PROTOCOL COMPATIBILITY

Where supported by the current product, preserve and improve:

### OpenAI-compatible

```text
/v1/models
/v1/chat/completions
/v1/responses
/v1/embeddings
```

as appropriate.

### Anthropic-compatible

Normalize:

* messages
* content blocks
* tool calls
* tool results
* streaming events

Never claim full compatibility without contract tests.

---

# 105. STREAMING

Streaming should remain first-class.

Support:

* SSE
* websocket if already used
* internal streaming between services where beneficial

Do not buffer an entire provider response before forwarding unless the pipeline explicitly needs that behavior.

---

# 106. CANCELLATION

Client cancellation should propagate:

```text
frontend
→ API
→ router
→ provider
→ agent/tool
```

where practical.

Do not continue expensive generation after the user disconnects unless running as an explicitly persistent job.

---

# 107. RATE LIMITS

Implement:

* global
* tenant
* user
* API key
* provider
* model
* endpoint
* tool
* crawler domain

Prefer token bucket/sliding window according to the use case.

---

# 108. QUEUE PRIORITIES

Support:

```text
interactive
high
normal
background
bulk
```

Interactive chat should not be starved by crawling/media jobs.

---

# 109. SCHEDULER

Support recurring jobs for:

* model discovery
* provider health
* price refresh
* website refresh
* registry updates
* source verification
* ranking snapshots
* cleanup
* retention

Use the existing scheduler if one exists.

---

# 110. BACKUP AND RETENTION

Define policies for:

* chats
* logs
* traces
* crawled content
* rankings
* memory
* media
* agent artifacts

Provide cleanup jobs.

Avoid unlimited growth.

---

# 111. AUDIT LOG

Record sensitive administrative actions:

* provider credential changes
* model changes
* routing policies
* user permissions
* plugin activation
* MCP activation
* skill activation
* deletion
* data export
* feature flag changes

Audit records should be tamper-resistant according to deployment requirements.

---

# 112. FAILURE INJECTION TESTING

Simulate:

* provider outage
* database outage
* cache outage
* scraper crash
* worker crash
* judge timeout
* MCP timeout
* local model failure
* malformed stream
* disk pressure

Verify graceful degradation.

---

# 113. ACCEPTANCE CRITERIA — CORE

Upgrade is unacceptable if:

* current chat breaks
* existing model integrations disappear
* existing users lose configuration
* database data is destroyed
* public APIs unexpectedly change
* deployment becomes unreproducible

---

# 114. ACCEPTANCE CRITERIA — SCRAPING

Must demonstrate:

* static crawl
* JS page crawl
* concurrent crawl
* rate limiting
* resume
* duplicate prevention
* content normalization
* source diff
* provenance
* job monitoring

---

# 115. ACCEPTANCE CRITERIA — DISCOVERY

Must demonstrate discovery of at least:

* models
* agents
* skills
* MCP servers
* provider updates

with canonicalization and source provenance.

---

# 116. ACCEPTANCE CRITERIA — ROUTING

Must demonstrate:

* alias deduplication
* provider fallback
* circuit breaking
* quota awareness
* capability matching
* cost-aware routing
* health-aware routing
* explicit routing explanation

---

# 117. ACCEPTANCE CRITERIA — ARENA/JUDGE

Must demonstrate:

* blind battle
* vote
* ranking update
* confidence data
* historical snapshot
* pairwise judge
* judge aggregation

---

# 118. ACCEPTANCE CRITERIA — AGENTS

Must demonstrate:

* one standalone agent
* one multi-agent workflow
* tool execution
* memory retrieval
* checkpointing
* retry
* budget limits
* human approval gate

---

# 119. ACCEPTANCE CRITERIA — MEMORY

Must demonstrate:

* creation
* semantic search
* relationship lookup
* scoped retrieval
* deletion
* provenance

---

# 120. ACCEPTANCE CRITERIA — LOCAL LLM

Must demonstrate:

* local inference
* streaming
* health
* model registration
* routing eligibility
* resource limits

---

# 121. ACCEPTANCE CRITERIA — MEDIA

Must demonstrate:

```text
prompt
→ script
→ assets
→ audio
→ timeline
→ subtitles
→ rendered video
→ QA
```

with resumable stages.

---

# 122. ACCEPTANCE CRITERIA — OPERATIONS

Dashboard must expose:

* provider health
* model health
* requests
* tokens
* costs
* route decisions
* agent jobs
* crawler jobs
* arena
* judges
* memory
* logs
* traces

---

# 123. FINAL DELIVERABLES

The completed upgrade must include:

1. Updated production source
2. New isolated engines
3. Database migrations
4. Regression tests
5. Engine tests
6. Security controls
7. Docker/deployment definitions
8. Feature flags
9. Dashboard integration
10. API documentation
11. Architecture documentation
12. Migration documentation
13. Rollback procedure
14. Third-party/license inventory
15. Production deployment checklist

---

# 124. REQUIRED FINAL REPORT

After implementation produce:

```text
SIMHA_UPGRADE_REPORT.md
```

containing:

## A. Existing architecture discovered

## B. Problems found

Classify:

```text
CRITICAL
HIGH
MEDIUM
LOW
```

## C. Existing functionality preserved

## D. Components added

## E. Database migrations

## F. API additions

## G. Security improvements

## H. Performance measurements

## I. Tests executed

For each:

```text
PASS
FAIL
SKIPPED
```

## J. Known limitations

## K. Deployment instructions

## L. Rollback instructions

## M. Recommended next steps

---

# 125. ABSOLUTE DEVELOPMENT RULES

Do NOT:

* fake implementations
* leave mock data in production
* silently swallow exceptions
* hard-code API secrets
* hard-code localhost for production
* bypass TLS validation
* disable authorization to solve development problems
* accept arbitrary shell commands without sandboxing
* execute scraped external code automatically
* assume provider capabilities
* fabricate model metadata
* fabricate pricing
* fabricate benchmark scores
* claim tests passed without executing them
* replace the existing project wholesale
* break existing interfaces merely to simplify new implementation

---

# 126. PRIORITY ORDER

When engineering decisions conflict, use this order:

1. Security
2. Existing production stability
3. Data integrity
4. Backward compatibility
5. Correctness
6. Reliability
7. Observability
8. Performance
9. Cost efficiency
10. Maintainability
11. Feature completeness
12. UI aesthetics

---

# 127. SIMHA NATIVE ARCHITECTURE PRINCIPLE

External repositories in this specification define **capability inspiration, not implementation ownership**.

The completed platform must feel like:

> **SIMHA ONLINE AI**

not a collection of externally glued repositories.

The engines should share native:

* authentication
* authorization
* model registry
* provider registry
* telemetry
* API standards
* admin design system
* configuration
* event contracts

while remaining independently deployable/disableable where appropriate.

---

# 128. TARGET END-STATE

The finished architecture should resemble:

```text
                        ┌──────────────────────┐
                        │   SIMHA ONLINE UI    │
                        └──────────┬───────────┘
                                   │
                        ┌──────────▼───────────┐
                        │ API / AUTH / RBAC    │
                        └──────────┬───────────┘
                                   │
                  ┌────────────────┴────────────────┐
                  │                                 │
        ┌─────────▼─────────┐             ┌────────▼────────┐
        │ Existing AI Core  │             │ SIMHA Control   │
        │ Chat + Router     │             │ Plane           │
        └─────────┬─────────┘             └────────┬────────┘
                  │                                 │
        ┌─────────▼─────────────────────────────────▼────────┐
        │           SIMHA INTELLIGENCE BUS                   │
        └─────────┬─────────┬─────────┬─────────┬───────────┘
                  │         │         │         │
            ┌─────▼───┐ ┌───▼────┐ ┌──▼─────┐ ┌▼──────────┐
            │ Routing │ │ Agents │ │ Memory │ │ Knowledge │
            └─────────┘ └────────┘ └────────┘ └───────────┘
                  │         │          │            │
            ┌─────▼───┐ ┌──▼─────┐ ┌──▼──────┐ ┌──▼──────┐
            │  Judge  │ │ Teams  │ │ Arena   │ │ Vectors │
            └─────────┘ └────────┘ └─────────┘ └──────────┘
                  │
        ┌─────────▼──────────────────────────────────────┐
        │ Discovery / Scraping / Reverse Intelligence  │
        └─────────────────────┬──────────────────────────┘
                              │
        ┌─────────────────────▼──────────────────────────┐
        │ Models • Agents • Skills • Plugins • MCP     │
        │ Providers • Websites • Repositories • Docs   │
        └────────────────────────────────────────────────┘

              + Local LLM Runtime
              + Media Production
              + Telemetry / Cost / Audit
```

---

# 129. EXECUTION INSTRUCTION

Do not merely provide recommendations.

Start by examining the current repository.

Then implement this upgrade progressively.

When the existing architecture conflicts with this specification:

1. preserve working production behavior,
2. adopt the intent of the requirement,
3. implement the least disruptive production-grade solution,
4. document the deviation and reason.

Do not stop at architecture diagrams.

Do not return a project skeleton containing placeholder services.

Do not rewrite functioning subsystems without justification.

Continue until the requested modules are **implemented, integrated through clean contracts, tested, documented and deployable**.

The final result must be:

> **A production-grade SIMHA Online AI platform whose existing chat/router remains stable while isolated intelligence, routing, evaluation, agent, memory, knowledge, local-inference, media and observability engines dramatically expand its capabilities.**
