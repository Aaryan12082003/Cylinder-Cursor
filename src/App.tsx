import { Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/shell'
import { AuditPage } from '@/pages/AuditPage'
import { BackupPage } from '@/pages/BackupPage'
import { CustomersPage } from '@/pages/CustomersPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { DispatchPage } from '@/pages/DispatchPage'
import { InventoryPage } from '@/pages/InventoryPage'
import { LedgerPage } from '@/pages/LedgerPage'
import { NotificationsPage } from '@/pages/NotificationsPage'
import { OutstandingPage } from '@/pages/OutstandingPage'
import { ReportsPage } from '@/pages/ReportsPage'
import { ReturnsPage } from '@/pages/ReturnsPage'
import { SettingsPage } from '@/pages/SettingsPage'

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/dispatch" element={<DispatchPage />} />
        <Route path="/returns" element={<ReturnsPage />} />
        <Route path="/ledger" element={<LedgerPage />} />
        <Route path="/outstanding" element={<OutstandingPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/backup" element={<BackupPage />} />
        <Route path="/audit" element={<AuditPage />} />
      </Route>
    </Routes>
  )
}
