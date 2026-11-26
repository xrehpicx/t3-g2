/** One-shot allow, then the other exact allow words. Session-wide approval is never inferred. */
const ALLOW_DECISIONS = ['accept', 'approve', 'proceed', 'allow']
/** Exact deny words. A substring such as "decline" inside another id is not a deny. */
const DENY_DECISIONS = ['decline', 'deny', 'reject', 'cancel']

export const isDenyDecision = (decision: string) => DENY_DECISIONS.includes(decision)

/** The decision id behind Allow and Deny. Null when that exact word is not one of the options. */
export function decide(decisions: string[]): { allow: string | null; deny: string | null } {
  return {
    allow: ALLOW_DECISIONS.find(d => decisions.includes(d)) ?? null,
    deny: DENY_DECISIONS.find(d => decisions.includes(d)) ?? null,
  }
}
