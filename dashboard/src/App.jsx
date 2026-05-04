import { useState, useEffect, useCallback } from 'react'
import {
  CheckCircle2, XCircle, Clock, RefreshCw, Package,
  Wifi, WifiOff, Bot, X, Download
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

const API = ''
const POLL_INTERVAL = 4000

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso)
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const statusStyles = {
  pending:  'bg-yellow-500/10 text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/10',
  approved: 'bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/10',
  rejected: 'bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/10',
}

const statusIcons = {
  pending:  <Clock size={10} />,
  approved: <CheckCircle2 size={10} />,
  rejected: <XCircle size={10} />,
}

function StatusBadge({ status }) {
  return (
    <Badge
      className={cn(
        'gap-1 border font-mono text-[11px] tracking-wide rounded-full',
        statusStyles[status]
      )}
    >
      {statusIcons[status]}
      {status}
    </Badge>
  )
}

function StatCard({ icon: Icon, label, value, colorClass }) {
  return (
    <Card className="fade-in">
      <CardContent className="pt-5 pb-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[13px] text-muted-foreground">{label}</span>
          <div className={cn('p-2 rounded-xl border', colorClass)}>
            <Icon size={14} />
          </div>
        </div>
        <div className="text-3xl font-bold tracking-tight">{value}</div>
      </CardContent>
    </Card>
  )
}

function ReceiptModal({ order, onClose, onVerify }) {
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const handle = async (action) => {
    setLoading(true)
    await onVerify(order.id, action, message)
    setLoading(false)
    onClose()
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden" showCloseButton={false}>
        <DialogHeader className="flex-row items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <DialogTitle className="font-semibold text-sm font-mono">{order.id}</DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {order.customerName}
              {order.customerUsername ? ` · @${order.customerUsername}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={order.status} />
            <Button variant="ghost" size="icon-sm" onClick={onClose}>
              <X size={16} />
            </Button>
          </div>
        </DialogHeader>

        <div className="p-6">
          {order.receiptFile ? (
            <div className="rounded-xl overflow-hidden border border-border mb-5">
              <img
                src={`/uploads/${order.receiptFile}`}
                alt="Receipt"
                className="w-full object-contain max-h-72 bg-secondary"
              />
            </div>
          ) : (
            <div className="rounded-xl border border-border mb-5 h-40 flex items-center justify-center bg-secondary">
              <span className="text-muted-foreground text-sm">No image</span>
            </div>
          )}

          {order.status === 'pending' ? (
            <>
              <label className="block text-xs text-muted-foreground mb-2">
                Optional message to customer
              </label>
              <Textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Leave blank to send default message..."
                rows={2}
                className="resize-none mb-4"
              />
              <div className="flex gap-3">
                <Button
                  className="flex-1 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 text-green-400"
                  disabled={loading}
                  onClick={() => handle('approve')}
                >
                  <CheckCircle2 size={15} /> Approve
                </Button>
                <Button
                  className="flex-1 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400"
                  disabled={loading}
                  onClick={() => handle('reject')}
                >
                  <XCircle size={15} /> Reject
                </Button>
              </div>
            </>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              This order has already been {order.status}.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function OrderRow({ order, onSelect }) {
  return (
    <Card
      onClick={() => onSelect(order)}
      className="group cursor-pointer transition-all duration-150 hover:border-primary/30 hover:bg-primary/5 fade-in"
    >
      <CardContent className="flex items-center gap-4 py-4">
        <div className="w-12 h-12 rounded-lg overflow-hidden shrink-0 border border-border bg-secondary">
          {order.receiptFile ? (
            <img src={`/uploads/${order.receiptFile}`} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Package size={16} className="text-muted-foreground" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium">{order.id}</span>
            <StatusBadge status={order.status} />
          </div>
          <p className="text-sm mt-0.5 truncate text-muted-foreground">
            {order.customerName || 'Unknown'}
            {order.customerUsername && <span className="ml-1">· @{order.customerUsername}</span>}
          </p>
        </div>

        <div className="text-right shrink-0">
          <div className="text-xs font-mono text-muted-foreground">{timeAgo(order.timestamp)}</div>
          <div className="text-xs mt-1 text-primary opacity-0 group-hover:opacity-100 transition-opacity">View →</div>
        </div>
      </CardContent>
    </Card>
  )
}

function exportToExcel(orders, filter) {
  const rows = orders.map(o => ({
    'Order ID':    o.id,
    'Status':      o.status,
    'Customer':    o.customerName || '',
    'Username':    o.customerUsername ? `@${o.customerUsername}` : '',
    'Timestamp':   new Date(o.timestamp).toLocaleString(),
  }))
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Orders')
  const filename = `orders_${filter}_${new Date().toISOString().slice(0,10)}.xlsx`
  XLSX.writeFile(wb, filename)
}

const FILTERS = ['all', 'pending', 'approved', 'rejected']

export default function App() {
  const [orders, setOrders] = useState([])
  const [stats, setStats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0 })
  const [selected, setSelected] = useState(null)
  const [filter, setFilter] = useState('all')
  const [connected, setConnected] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const [ordersRes, statsRes] = await Promise.all([
        fetch(`${API}/api/orders`),
        fetch(`${API}/api/stats`)
      ])
      setOrders(await ordersRes.json())
      setStats(await statsRes.json())
      setConnected(true)
      setLastRefresh(new Date())
    } catch {
      setConnected(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [fetchData])

  const handleVerify = async (orderId, action, message) => {
    await fetch(`${API}/api/orders/${orderId}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, message })
    })
    await fetchData()
  }

  const filtered = filter === 'all' ? orders : orders.filter(o => o.status === filter)

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border sticky top-0 z-40 bg-background/90 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-primary/15 border border-primary/30">
              <Bot size={16} className="text-primary" />
            </div>
            <div>
              <div className="font-semibold text-sm">Order Dashboard</div>
              <div className="text-xs text-muted-foreground">
                {lastRefresh ? `Updated ${timeAgo(lastRefresh.toISOString())}` : 'Loading...'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge
              className={cn(
                'gap-1.5 font-mono text-xs px-3 py-1.5 rounded-full border',
                connected
                  ? 'bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/10'
                  : 'bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/10'
              )}
            >
              {connected ? <Wifi size={11} /> : <WifiOff size={11} />}
              {connected ? 'Live' : 'Offline'}
            </Badge>
            <Button variant="outline" size="sm" onClick={fetchData}>
              <RefreshCw size={12} /> Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard icon={Package}      label="Total Orders" value={stats.total}    colorClass="text-primary bg-primary/10 border-primary/20" />
          <StatCard icon={Clock}        label="Pending"      value={stats.pending}  colorClass="text-yellow-400 bg-yellow-400/10 border-yellow-400/20" />
          <StatCard icon={CheckCircle2} label="Approved"     value={stats.approved} colorClass="text-green-400 bg-green-400/10 border-green-400/20" />
          <StatCard icon={XCircle}      label="Rejected"     value={stats.rejected} colorClass="text-red-400 bg-red-400/10 border-red-400/20" />
        </div>

        {/* Filter tabs */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            {FILTERS.map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-150 border',
                  filter === f
                    ? 'bg-primary text-primary-foreground border-transparent'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-border/60'
                )}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
                {f === 'pending' && stats.pending > 0 && (
                  <span className="ml-1.5 bg-yellow-400/20 text-yellow-400 text-xs px-1.5 py-0.5 rounded-full">
                    {stats.pending}
                  </span>
                )}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportToExcel(filtered, filter)}
            disabled={filtered.length === 0}
          >
            <Download size={12} /> Export Excel
          </Button>
        </div>

        {/* Orders list */}
        {!connected ? (
          <Card>
            <CardContent className="py-12 text-center">
              <WifiOff size={32} className="mx-auto mb-3 text-muted-foreground" />
              <div className="font-medium mb-1">Can't reach the bot server</div>
              <div className="text-sm text-muted-foreground">Make sure the backend is running on port 3001</div>
            </CardContent>
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Package size={32} className="mx-auto mb-3 text-muted-foreground" />
              <div className="font-medium mb-1">No orders yet</div>
              <div className="text-sm text-muted-foreground">Orders will appear here when customers send receipts</div>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map(order => (
              <OrderRow key={order.id} order={order} onSelect={setSelected} />
            ))}
          </div>
        )}
      </div>

      {selected && (
        <ReceiptModal
          order={selected}
          onClose={() => setSelected(null)}
          onVerify={handleVerify}
        />
      )}
    </div>
  )
}
