/**
 * dsh-paste-code-block — host (node) half.
 *
 * Pure UI plugin: the host body is intentionally empty. The browser half ships
 * via exports["./client"], discovered through the package.json `dsh.client`
 * declaration and mounted into the Web composer by the host layer.
 */
export const name = 'dsh-paste-code-block'

/** Host plugin body — no host-side behavior. */
export function apply() {}
