/** Svelte action: focus a field as it appears. `autofocus` acts only when nothing has focus, and
 *  Chrome leaves focus on the button that opened the field (the rename pencil, the size readout):
 *  the field stayed unfocused and the letters typed ran tool shortcuts (slop-paint 9e85881). */
export function focusNow(node: HTMLInputElement) {
  node.focus();
}
