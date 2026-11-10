/**
 * Shared fakes for the Phase 2 suites (not a test file: the `*.test.mjs` glob skips it).
 *
 * `fakeDdb()` is an in-memory DynamoDB speaking the raw-AttributeValue commands this Lambda sends,
 * for BOTH tables (keyed by TableName + pk + sk). It interprets exactly the update and condition
 * expressions `alertsStore.mjs` and `ddb.mjs countOne` write; an expression it does not know
 * throws, so a store change that the fake would silently mis-model fails loudly instead.
 */

import { afterEach, beforeEach } from 'node:test';

class Cmd {
  constructor(input) {
    this.input = input;
  }
}
export class GetItemCommand extends Cmd {}
export class PutItemCommand extends Cmd {}
export class UpdateItemCommand extends Cmd {}
export class DeleteItemCommand extends Cmd {}
export class QueryCommand extends Cmd {}
export class ScanCommand extends Cmd {}

const COMMANDS = {
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  QueryCommand,
  ScanCommand,
};

const keyOf = (table, key) => `${table}|${key.pk.S}|${key.sk?.S ?? ''}`;
const ccf = () =>
  Object.assign(new Error('condition failed'), { name: 'ConditionalCheckFailedException' });
const numOf = (av) => (av === undefined ? undefined : Number(av.N));

/** The conditions the store writes → predicate(item | undefined, values, names). */
const CONDITIONS = {
  'attribute_not_exists(#n) OR #n < :max': (it, v, n) =>
    it?.[n['#n']] === undefined || numOf(it[n['#n']]) < numOf(v[':max']),
  'attribute_not_exists(provider_id) AND (attribute_not_exists(claimed_at) OR claimed_at < :stale)':
    (it, v) =>
      it?.provider_id === undefined &&
      (it?.claimed_at === undefined || numOf(it.claimed_at) < numOf(v[':stale'])),
  'attribute_exists(sk)': (it) => it !== undefined,
  'attribute_exists(sk) AND sent_rev = :old': (it, v) =>
    it !== undefined && it.sent_rev?.S === v[':old'].S,
};

/** Apply an UpdateExpression of the shapes the store writes. */
function applyUpdate(item, expr, values = {}, names = {}) {
  const out = { ...item };
  const clauses = expr.split(/\b(?=SET |REMOVE |ADD )/);
  for (const clause of clauses) {
    const c = clause.trim();
    if (c.startsWith('SET ')) {
      for (const part of c.slice(4).split(/,\s*(?![^(]*\))/)) {
        const m = /^(\S+) = (.+)$/.exec(part.trim());
        if (!m) throw new Error(`fake ddb: unknown SET part "${part}"`);
        const attr = names[m[1]] ?? m[1];
        const ine = /^if_not_exists\((\S+), (:\w+)\)$/.exec(m[2]);
        if (ine) out[attr] = out[attr] ?? values[ine[2]];
        else if (/^:\w+$/.test(m[2])) out[attr] = values[m[2]];
        else throw new Error(`fake ddb: unknown SET value "${m[2]}"`);
      }
    } else if (c.startsWith('REMOVE ')) {
      for (const a of c.slice(7).split(',')) delete out[a.trim()];
    } else if (c.startsWith('ADD ')) {
      const m = /^ADD (\S+) (:\w+)$/.exec(c);
      if (!m) throw new Error(`fake ddb: unknown ADD "${c}"`);
      const attr = names[m[1]] ?? m[1];
      out[attr] = { N: String((numOf(out[attr]) ?? 0) + numOf(values[m[2]])) };
    } else if (c) {
      throw new Error(`fake ddb: unknown clause "${c}"`);
    }
  }
  return out;
}

export function fakeDdb({ pageSize = Infinity } = {}) {
  const items = new Map();
  const calls = [];
  let failing = null;

  function partition(table, pk) {
    return [...items.entries()]
      .filter(([k]) => k.startsWith(`${table}|${pk}|`))
      .map(([, v]) => v)
      .sort((a, b) => (a.sk?.S ?? '').localeCompare(b.sk?.S ?? ''));
  }

  function page(list, startKey) {
    let start = 0;
    if (startKey) start = list.findIndex((it) => keyOf('', it) === keyOf('', startKey)) + 1;
    const slice = list.slice(start, start + pageSize);
    const more = start + pageSize < list.length;
    return { slice, last: more ? { pk: slice.at(-1).pk, sk: slice.at(-1).sk } : undefined };
  }

  const send = async (cmd) => {
    const op = cmd.constructor.name;
    const input = cmd.input;
    calls.push({ op, input });
    if (failing?.(op, input)) {
      throw Object.assign(new Error('store down'), { name: 'ServiceUnavailable' });
    }
    const T = input.TableName;
    if (op === 'GetItemCommand') {
      const it = items.get(keyOf(T, input.Key));
      return it ? { Item: structuredClone(it) } : {};
    }
    if (op === 'PutItemCommand') {
      items.set(keyOf(T, input.Item), structuredClone(input.Item));
      return {};
    }
    if (op === 'DeleteItemCommand') {
      items.delete(keyOf(T, input.Key));
      return {};
    }
    if (op === 'UpdateItemCommand') {
      const k = keyOf(T, input.Key);
      const cur = items.get(k);
      const values = input.ExpressionAttributeValues ?? {};
      const names = input.ExpressionAttributeNames ?? {};
      if (input.ConditionExpression) {
        const pred = CONDITIONS[input.ConditionExpression];
        if (!pred) throw new Error(`fake ddb: unknown condition "${input.ConditionExpression}"`);
        if (!pred(cur, values, names)) throw ccf();
      }
      const next = applyUpdate(cur ?? { ...input.Key }, input.UpdateExpression, values, names);
      items.set(k, next);
      return input.ReturnValues === 'ALL_OLD' && cur ? { Attributes: structuredClone(cur) } : {};
    }
    if (op === 'QueryCommand') {
      const v = input.ExpressionAttributeValues;
      let list = partition(T, v[':pk'].S);
      if (input.KeyConditionExpression === 'pk = :pk AND begins_with(sk, :prefix)') {
        list = list.filter((it) => it.sk.S.startsWith(v[':prefix'].S));
      } else if (input.KeyConditionExpression !== 'pk = :pk') {
        throw new Error(`fake ddb: unknown key condition "${input.KeyConditionExpression}"`);
      }
      const { slice, last } = page(list, input.ExclusiveStartKey);
      let result = slice;
      if (input.FilterExpression === 'expires_at > :now') {
        result = slice.filter((it) => numOf(it.expires_at) > numOf(v[':now']));
      } else if (input.FilterExpression) {
        throw new Error(`fake ddb: unknown filter "${input.FilterExpression}"`);
      }
      const out =
        input.Select === 'COUNT' ? { Count: result.length } : { Items: structuredClone(result) };
      return last ? { ...out, LastEvaluatedKey: last } : out;
    }
    if (op === 'ScanCommand') {
      const list = [...items.entries()].filter(([k]) => k.startsWith(`${T}|`)).map(([, v]) => v);
      const { slice, last } = page(list, input.ExclusiveStartKey);
      return { Items: structuredClone(slice), ...(last ? { LastEvaluatedKey: last } : {}) };
    }
    throw new Error(`fake ddb: unexpected command ${op}`);
  };

  return {
    send,
    commands: COMMANDS,
    items,
    calls,
    ops: () => calls.map((c) => c.op),
    failOn(fn) {
      failing = fn;
    },
    /** One item by table/pk/sk, as raw AttributeValues (or undefined). */
    get(table, pk, sk) {
      return items.get(`${table}|${pk}|${sk ?? ''}`);
    },
    /** Seed one item from plain values (strings → S, numbers → N). */
    seed(table, plain) {
      const item = {};
      for (const [k, v] of Object.entries(plain)) {
        if (v === undefined) continue;
        item[k] = typeof v === 'number' ? { N: String(v) } : { S: String(v) };
      }
      items.set(`${table}|${plain.pk}|${plain.sk ?? ''}`, item);
    },
    partition,
  };
}

/** Same shape as the adapter's ProviderError, without importing the adapter. */
export class FakeProviderError extends Error {
  constructor(code, httpStatus) {
    super(code);
    this.name = 'ProviderError';
    this.code = code;
    if (httpStatus !== undefined) this.httpStatus = httpStatus;
  }
}

/**
 * A fake bound alerts client. `subs` is the provider's list (`{ id, flight, url }`).
 * Override any method through `impl`.
 */
export function fakeAlertsClient(impl = {}) {
  const calls = [];
  const state = { subs: [], balance: 500, nextId: 1 };
  const client = {
    calls,
    state,
    async subscribeAlert(flight, url) {
      calls.push(['subscribeAlert', flight, url]);
      if (impl.subscribeAlert) return impl.subscribeAlert(flight, url);
      const id = `sub-${state.nextId++}`;
      state.subs.push({ id, flight, url });
      return { id };
    },
    async cancelAlert(id) {
      calls.push(['cancelAlert', id]);
      if (impl.cancelAlert) return impl.cancelAlert(id);
      state.subs = state.subs.filter((s) => s.id !== id);
    },
    async listAlerts() {
      calls.push(['listAlerts']);
      if (impl.listAlerts) return impl.listAlerts();
      return state.subs.map((s) => ({ ...s }));
    },
    async getBalance() {
      calls.push(['getBalance']);
      if (impl.getBalance) return impl.getBalance();
      return state.balance;
    },
    async refillCredits(n) {
      calls.push(['refillCredits', n]);
      if (impl.refillCredits) return impl.refillCredits(n);
      state.balance = (state.balance ?? 0) + n;
      return { creditsRemaining: state.balance, quota: { remaining: 4000, limit: 5000 } };
    },
    parseWebhook(body) {
      if (impl.parseWebhook) return impl.parseWebhook(body);
      return body?.__parsed ?? null;
    },
  };
  return client;
}

/** Fake senders: `outcome(platform, msg)` decides each send. */
export function fakeSenders(outcome = () => ({ ok: true })) {
  const sent = [];
  let closed = 0;
  const make = (platform) => ({
    async send(msg) {
      sent.push({ platform, ...msg });
      return outcome(platform, msg);
    },
  });
  const senders = { ios: make('ios'), android: make('android') };
  return {
    sent,
    get closed() {
      return closed;
    },
    senderFor: (p) => senders[p] ?? null,
    close() {
      closed += 1;
    },
  };
}

/** Capture console output per test; `logs()` returns the current capture. */
export function captureConsole() {
  let logs = { log: [], warn: [], error: [] };
  const originals = {};
  beforeEach(() => {
    logs = { log: [], warn: [], error: [] };
    for (const level of Object.keys(logs)) {
      originals[level] = console[level];
      console[level] = (...args) => logs[level].push(args.map(String).join(' '));
    }
  });
  afterEach(() => {
    for (const level of Object.keys(logs)) console[level] = originals[level];
  });
  return () => logs;
}

/** Every structured JSON line with this `msg`. */
export function linesFor(logs, msg) {
  return logs.log
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l))
    .filter((l) => l.msg === msg);
}

export const json = (res) => (res.body ? JSON.parse(res.body) : null);
