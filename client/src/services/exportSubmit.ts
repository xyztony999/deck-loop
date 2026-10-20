/** Confirm before submission: an unconfirmed PPTX request is a business error on the server. */
export async function submitWithConfirmation<T extends { exportId?: string; needConfirm?: boolean }>(
  format: string,
  send: (confirm?: boolean) => Promise<T>,
  confirmBeta: () => Promise<boolean>,
): Promise<boolean> {
  if (format === 'PPTX') {
    if (!await confirmBeta()) return false
    return !!(await send(true)).exportId
  }
  const response = await send()
  if (!response.exportId && response.needConfirm) {
    if (!await confirmBeta()) return false
    return !!(await send(true)).exportId
  }
  return !!response.exportId
}
