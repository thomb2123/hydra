// Resolved when the launch intro has finished, so start-up work that would compete with
// it for frames (reading and ranking the channel list) can wait for it.
let finish: () => void = () => undefined;
export const introFinished = new Promise<void>((resolve) => {
  finish = resolve;
});
export function markIntroFinished(): void {
  finish();
}
