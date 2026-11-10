/**
 * session/clear/new 的纯状态机。
 * 只产生 effects 描述符，不执行副作用；adapter 决定是否真正执行。
 */
export const PHASE = {
  idle: 'idle',
  clearing: 'clearing',
  cleared: 'cleared',
  starting: 'starting',
  active: 'active',
  ended: 'ended',
  error: 'error',
};

export function initSession(over = {}) {
  return {
    phase: PHASE.idle,
    sessionId: null,
    clearToken: null,
    newToken: null,
    autoStarted: false,
    seq: 0,
    ...over,
  };
}

const effect = (type, extra = {}) => ({ type, ...extra });

function reject(state, event, reason) {
  return {
    state: { ...state, seq: state.seq + 1 },
    effects: [],
    rejected: { reason, event: event.type, token: event.token || null },
  };
}

function accept(state, patch, effects = []) {
  return { state: { ...state, ...patch, seq: state.seq + 1 }, effects, rejected: null };
}

export function reduceSession(state, event = {}) {
  const type = event.type;
  const token = event.token || null;

  if (type === 'clear/request') {
    if (!token) return reject(state, event, 'missing_token');
    if (state.phase === PHASE.clearing) return reject(state, event, 'already_clearing');
    return accept(state, {
      phase: PHASE.clearing,
      clearToken: token,
      newToken: null,
      autoStarted: false,
      sessionId: null,
    }, [
      effect('cancel.inflight'),
      effect('board.clear'),
      effect('queue.clear'),
      effect('ledger.clear'),
      effect('epoch.bump'),
      effect('ui.reset'),
    ]);
  }

  if (type === 'clear/boardDone' || type === 'clear/done') {
    if (state.phase !== PHASE.clearing) return reject(state, event, 'not_clearing');
    if (token !== state.clearToken) return reject(state, event, 'stale_clear_token');
    return accept(state, { phase: PHASE.cleared }, [effect('ui.clearDone')]);
  }

  if (type === 'new/request') {
    if (!token) return reject(state, event, 'missing_token');
    if (state.phase === PHASE.clearing) return reject(state, event, 'clear_in_progress');
    if (state.phase === PHASE.starting) return reject(state, event, 'already_starting');
    return accept(state, {
      phase: PHASE.starting,
      newToken: token,
      clearToken: null,
      sessionId: null,
      autoStarted: false,
    }, [
      effect('cancel.inflight'),
      effect('chat.clear'),
      effect('ledger.clear'),
      effect('facts.clear'),
      effect('board.reset'),
      effect('epoch.bump'),
      effect('session.start'),
      effect('ui.reset'),
    ]);
  }

  if (type === 'new/started') {
    if (state.phase !== PHASE.starting) return reject(state, event, 'not_starting');
    if (token !== state.newToken) return reject(state, event, 'stale_new_token');
    return accept(state, {
      phase: PHASE.active,
      sessionId: event.sessionId || null,
      autoStarted: false,
    }, [effect('agent.autoStart')]);
  }

  if (type === 'auto/started') {
    if (state.phase !== PHASE.active) return reject(state, event, 'not_active');
    if (state.autoStarted) return reject(state, event, 'already_auto_started');
    return accept(state, { autoStarted: true });
  }

  if (type === 'session/end') {
    return accept(state, { phase: PHASE.ended, autoStarted: true }, [
      effect('cancel.inflight'),
      effect('queue.clear'),
    ]);
  }

  if (type === 'session/error') {
    return accept(state, { phase: PHASE.error }, [effect('cancel.inflight')]);
  }

  return reject(state, event, 'unknown_event');
}
