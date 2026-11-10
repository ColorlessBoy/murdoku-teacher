import { E } from './events.js';

/**
 * 把一次 LLM 请求绑定到明确 session/step/request。
 * 只能写已提交的 SessionEvent；stale 检查在调用前后各做一次。
 */
export async function requestBound({ session, requestId, stepId, messages = [], call, isCurrent = null } = {}) {
  if (!session || session.status !== 'active') return { ok: false, rejected: 'session_not_active' };
  if (!requestId || !stepId) return { ok: false, rejected: 'missing_ids' };
  if (typeof call !== 'function') return { ok: false, rejected: 'missing_call' };
  if (isCurrent && !(await isCurrent())) return { ok: false, rejected: 'stale_before_call' };

  session.append(E.llmRequest, { messageCount: messages.length }, { requestId, stepId });
  let result;
  try {
    result = await call();
  } catch (e) {
    session.append(E.llmResponse, { status: 'error', message: e.message }, { requestId, stepId });
    return { ok: false, rejected: 'llm_error', error: e.message, original: e };
  }
  if (isCurrent && !(await isCurrent())) return { ok: false, rejected: 'stale_after_call' };
  session.append(E.llmResponse, { status: 'ok', toolCalls: result?.toolCalls?.length || 0, textLength: String(result?.text || '').length }, { requestId, stepId });
  return { ok: true, result };
}
