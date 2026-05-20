import { useEffect, useRef, useState } from "react";
import { Send, Trash2 } from "lucide-react";
import { Grbl } from "../lib/grbl";

interface Props {
  lines: string[];
  onClear: () => void;
  connected: boolean;
}

export default function Console({ lines, onClear, connected }: Props) {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  const send = () => {
    const cmd = input.trim();
    if (!cmd || !connected) return;
    Grbl.sendCommand(cmd);
    setHistory((h) => [cmd, ...h.slice(0, 49)]);
    setHistIdx(-1);
    setInput("");
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { send(); return; }
    if (e.key === "ArrowUp") {
      const idx = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(idx);
      setInput(history[idx] ?? "");
    }
    if (e.key === "ArrowDown") {
      const idx = Math.max(histIdx - 1, -1);
      setHistIdx(idx);
      setInput(idx === -1 ? "" : history[idx]);
    }
  };

  const lineColor = (l: string) => {
    if (l.startsWith("ALARM")) return "text-red-400";
    if (l.startsWith("error")) return "text-red-400";
    if (l.startsWith("ok")) return "text-green-500";
    if (l.startsWith("<")) return "text-blue-400";
    if (l.startsWith("[")) return "text-amber-400";
    if (l.startsWith(">")) return "text-[#9b9b98]";
    return "text-[#d1d0ce]";
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#e9e9e7]">
        <span className="text-[11px] font-medium text-[#787774] uppercase tracking-wider">Console</span>
        <button
          onClick={onClear}
          className="p-1 rounded hover:bg-[#f0f0ee] text-[#9b9b98] hover:text-[#787774] transition-colors"
          title="Clear"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Output */}
      <div className="flex-1 overflow-y-auto p-3 bg-[#1c1c1e] font-mono text-[12px] leading-5">
        {lines.map((l, i) => (
          <div key={i} className={lineColor(l)}>
            {l}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-t border-[#e9e9e7] bg-white">
        <span className="text-[12px] font-mono text-[#9b9b98]">{'>'}</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          disabled={!connected}
          placeholder={connected ? "Send GRBL command…" : "Not connected"}
          className="flex-1 text-[12px] font-mono bg-transparent outline-none text-[#37352f] placeholder:text-[#c7c6c4] disabled:opacity-40"
        />
        <button
          onClick={send}
          disabled={!connected || !input.trim()}
          className="p-1.5 rounded hover:bg-[#f0f0ee] text-[#787774] disabled:opacity-30 transition-colors"
        >
          <Send size={13} />
        </button>
      </div>
    </div>
  );
}
