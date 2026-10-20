export async function canLogout(
  listTasks: (status: 'QUEUED' | 'RUNNING') => Promise<{ total: number }>,
): Promise<boolean> {
  const pages = await Promise.all([listTasks('QUEUED'), listTasks('RUNNING')])
  return pages.every((page) => page.total === 0)
}
