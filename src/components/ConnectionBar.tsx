import { useEffect, useState } from "react";
import { RefreshCw, Plug, PlugZap } from "lucide-react";
import { Grbl } from "../lib/grbl";

interface Props {
  connected: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onError: (message: string) => void;
}

export default function ConnectionBar({ connected, onConnect, onDisconnect, onError }: Props) {
  const [ports, setPorts] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    try {
      const p = await Grbl.listPorts();
      setPorts(p);
      if (p.length > 0 && !selected) setSelected(p[0]);
    } catch (e) {
      onError(`Could not list serial ports: ${String(e)}`);
    }
  };

  useEffect(() => { refresh(); }, []);

  const handleConnect = async () => {
    if (!selected) return;
    setLoading(true);
    try {
      await Grbl.connect(selected);
      onConnect();
    } catch (e) {
      onError(`Connect failed on ${selected}: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    await Grbl.disconnect();
    onDisconnect();
  };

  return (
    <div className="h-11 border-b border-[#e9e9e7] flex items-center px-4 gap-3 drag-region bg-white">
      <div className="flex-1" /> {/* spacer for traffic lights */}

      <div className="flex items-center gap-2 no-drag">
        {/* Port selector */}
        <div className="relative">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={connected}
            className="appearance-none bg-[#f7f7f5] border border-[#e9e9e7] text-[12px] text-[#37352f] rounded-md pl-3 pr-7 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#37352f] disabled:opacity-40"
          >
            {ports.length === 0 && <option value="">No ports found</option>}
            {ports.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#787774] text-[10px]">▾</span>
        </div>

        {/* Refresh */}
        <button
          onClick={refresh}
          disabled={connected}
          className="p-1.5 rounded-md hover:bg-[#f0f0ee] disabled:opacity-40 text-[#787774] transition-colors"
          title="Refresh ports"
        >
          <RefreshCw size={13} />
        </button>

        {/* Connect / Disconnect */}
        {!connected ? (
          <button
            onClick={handleConnect}
            disabled={!selected || loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#37352f] text-white text-[12px] rounded-md hover:bg-[#2c2b26] disabled:opacity-40 transition-colors font-medium"
          >
            <Plug size={12} />
            {loading ? "Connecting…" : "Connect"}
          </button>
        ) : (
          <button
            onClick={handleDisconnect}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#e9e9e7] text-[#37352f] text-[12px] rounded-md hover:bg-[#f7f7f5] transition-colors font-medium"
          >
            <PlugZap size={12} />
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}
