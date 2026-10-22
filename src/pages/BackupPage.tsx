import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatTimestamp } from '@shared/dates'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button, Card, Dialog, DialogContent, EmptyState, Field, Input, Page } from '@/components/ui'
import { api } from '@/lib/api'
import { DatabaseBackup } from 'lucide-react'

export function BackupPage() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['backups'], queryFn: api.backups })
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings })
  const [restoreId, setRestoreId] = useState<number | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [fileRestore, setFileRestore] = useState(false)
  const create = useMutation({
    mutationFn: api.createBackup,
    onSuccess: (backup) => {
      toast.success(`Backup saved to ${backup.filePath}`)
      qc.invalidateQueries()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  return (
    <Page
      title="Backup & restore"
      subtitle="Backups use SQLite's online backup and are checked before they are kept. Restoring replaces the live database only after you type RESTORE."
      actions={
        <>
          <Button variant="secondary" onClick={() => api.chooseBackupDir().then((result) => { toast.success(`Backup folder: ${result.directory}`); qc.invalidateQueries() })}>Choose folder</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>Back up now</Button>
        </>
      }
    >
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <Card className="p-4"><div className="text-xs text-muted">Automatic backup</div><div className="mt-1 font-semibold">{settings.data?.autoBackup ? 'On launch' : 'Off'}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted">Copies to keep</div><div className="mt-1 font-semibold">{settings.data?.backupRetention ?? 15}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted">Folder</div><div className="mt-1 truncate text-sm font-medium">{settings.data?.backupDirectory || 'Application data / backups'}</div></Card>
      </div>
      <div className="mb-4 flex gap-2">
        <Button variant="secondary" onClick={() => api.integrity().then((result) => result.ok ? toast.success('Database integrity check passed') : toast.error(result.message))}>Verify database</Button>
        <Button variant="secondary" onClick={() => setFileRestore(true)}>Restore from file</Button>
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-left text-[13px]">
          <thead className="text-xs uppercase tracking-wide text-muted"><tr>{['When', 'Kind', 'Size', 'Location', ''].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
          <tbody>
            {list.data?.map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="px-4 py-3">{formatTimestamp(row.createdAt)}</td>
                <td className="px-4 py-3 capitalize">{row.kind}</td>
                <td className="px-4 py-3">{Math.ceil(row.fileSize / 1024)} KB</td>
                <td className="px-4 py-3 max-w-md truncate">{row.filePath}</td>
                <td className="px-4 py-3 text-right"><Button size="sm" variant="secondary" onClick={() => { setRestoreId(row.id); setConfirmation('') }}>Restore</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data && list.data.length === 0 ? <EmptyState icon={<DatabaseBackup className="h-5 w-5" />} title="No backups yet" body="Create one before a large stock correction. An automatic copy is also taken on launch when that setting is on." /> : null}
      </Card>
      <Dialog open={restoreId !== null || fileRestore} onOpenChange={(open) => { if (!open) { setRestoreId(null); setFileRestore(false) } }}>
        <DialogContent title="Restore database" description="This replaces the current records with the backup. Type RESTORE to continue. A copy of the current file is kept beside the database if the restore fails." className="max-w-md">
          <Field label="Confirmation"><Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="RESTORE" /></Field>
          <div className="mt-4 flex justify-end">
            <Button
              variant="danger"
              disabled={confirmation !== 'RESTORE'}
              onClick={() => {
                const run = fileRestore ? api.restoreFile(confirmation) : api.restoreBackup(restoreId!, confirmation)
                run.then(() => {
                  toast.success('Database restored')
                  setRestoreId(null)
                  setFileRestore(false)
                  qc.invalidateQueries()
                }).catch((error: Error) => toast.error(error.message))
              }}
            >
              Restore
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Page>
  )
}
