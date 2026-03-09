# Plan: LLM-Powered Help Chatbot (OpenRouter + Gemini Flash)

> Date: 2026-03-09
> Related issues: TBD

## Context

beanies.family is growing in features and complexity. Users need comprehensive, accessible help that covers UI usage, app logic, security architecture, and trustworthiness — delivered in a fun, engaging way that matches the beanies personality. Rather than traditional help pages, we're building an LLM chatbot that deeply understands the app, speaks casually with movie references, and provides transparent answers about security and encryption.

**Provider:** OpenRouter (API aggregator — single API, swap models via config string)
**Starting model:** Google Gemini Flash (via OpenRouter, ~$0.075/1M input tokens)
**Knowledge injection:** System prompt + public help docs embedded as structured constants
**Placement:** Floating widget on Settings page only (V1)
**Auth:** Authenticated users only
**Chat history:** Persisted in IndexedDB (per-member)
**Rate limiting:** Per-family DynamoDB counter (default 30 req/hour)

## Approach

- Backend: Chat proxy Lambda + DynamoDB rate limiting + Terraform module
- Frontend: chatService (follows oauthProxy pattern) + chatHistoryRepository (follows translationCache pattern) + ChatWidget/ChatMessage components
- System prompt contains personality + all docs (~5000-5500 tokens)
- Reuses existing composables: wrapAsync, useOnline, useBreakpoint, useConfirm, useTranslation, useSounds
- Feature-gated via VITE_CHAT_ENABLED env var

## Files affected

### New files:

- `infrastructure/lambda/chat/index.mjs`
- `infrastructure/lambda/chat/systemPrompt.mjs`
- `infrastructure/modules/chat/main.tf`
- `infrastructure/modules/chat/variables.tf`
- `infrastructure/modules/chat/outputs.tf`
- `src/services/chat/chatService.ts`
- `src/services/indexeddb/repositories/chatHistoryRepository.ts`
- `src/composables/useChat.ts`
- `src/components/chat/ChatWidget.vue`
- `src/components/chat/ChatMessage.vue`

### Modified files:

- `infrastructure/main.tf`
- `infrastructure/variables.tf`
- `infrastructure/outputs.tf`
- `src/types/models.ts`
- `src/services/translation/uiStrings.ts`
- `src/pages/SettingsPage.vue`
- `src/stores/authStore.ts`
- `.env.example`
- `.github/workflows/deploy.yml`
