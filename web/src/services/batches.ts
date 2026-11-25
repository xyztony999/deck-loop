export async function mapBatches<T, R>(items: T[], size: number, run: (batch: T[]) => Promise<R[]>): Promise<R[]> {
  if (!Number.isInteger(size) || size < 1) throw new Error('Invalid batch size')
  const result: R[] = []
  for (let start = 0; start < items.length; start += size) {
    result.push(...await run(items.slice(start, start + size)))
  }
  return result
}
