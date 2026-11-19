"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { FileText, Loader2, Play, ScanLine, UploadCloud, X } from "lucide-react";
import samples from "@/lib/samples-manifest.json";
import { api } from "@/lib/api";
import { fmtBytes } from "@/lib/format";
import { Button, Card, CardHeader, ErrorBanner, PageHeader, StatusBadge } from "@/components/ui";

type Sample = (typeof samples)[number];

export default function ProcessPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [maxMb, setMaxMb] = useState(10);
  const [progress, setProgress] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingSample, setLoadingSample] = useState<string | null>(null);
  const [selectedSample, setSelectedSample] = useState<Sample | null>(null);

  useEffect(() => {
    api<{ limits: { maxUploadMb: number } }>("/api/settings").then((s) => setMaxMb(s.limits.maxUploadMb)).catch(() => undefined);
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const accept = (f: File, sample: Sample | null = null) => {
    setError(null);
    const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
    if (!isPdf) return setError(`"${f.name}" is not a PDF. Only PDF invoices are accepted.`);
    if (f.size === 0) return setError("The selected file is empty.");
    if (f.size > maxMb * 1024 * 1024) return setError(`"${f.name}" is ${fmtBytes(f.size)}. The maximum allowed size is ${maxMb} MB.`);
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setSelectedSample(sample);
    setPreview(URL.createObjectURL(f));
  };

  const loadSample = async (s: Sample) => {
    setLoadingSample(s.file);
    try {
      const res = await fetch(`/samples/${s.file}`);
      if (!res.ok) throw new Error("Could not load sample file");
      const blob = await res.blob();
      accept(new File([blob], s.file, { type: "application/pdf" }), s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingSample(null);
    }
  };

  const clear = () => { setFile(null); setSelectedSample(null); if (preview) URL.revokeObjectURL(preview); setPreview(null); setProgress(null); };

  const start = () => {
    if (!file || submitting) return; // prevents double submission
    setSubmitting(true);
    setError(null);
    setProgress(0);
    const form = new FormData();
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/runs");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      const body = (() => { try { return JSON.parse(xhr.responseText); } catch { return null; } })();
      if (xhr.status >= 200 && xhr.status < 300 && body?.runId) {
        setProgress(100);
        router.push(`/runs/${body.runId}`);
      } else {
        setError(body?.error ?? `Upload failed (HTTP ${xhr.status})`);
        setSubmitting(false);
        setProgress(null);
      }
    };
    xhr.onerror = () => { setError("Network error: the upload could not reach the server."); setSubmitting(false); setProgress(null); };
    xhr.send(form);
  };

  return (
    <>
      <PageHeader title="Process Invoice" description="Upload a vendor invoice PDF. Each of the nine processing stages runs on the server, and you can watch them live." />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader title="Upload invoice" subtitle={`PDF only · up to ${maxMb} MB · text-based or scanned`} />
            <div className="p-5">
              {!file ? (
                <div
                  onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) accept(f); }}
                  onClick={() => inputRef.current?.click()}
                  role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
                  className={clsx("flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors",
                    drag ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-blue-400 hover:bg-slate-50")}
                >
                  <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600"><UploadCloud className="h-6 w-6" /></span>
                  <p className="text-sm font-medium text-slate-800">Drag & drop an invoice PDF here</p>
                  <p className="mt-1 text-xs text-slate-500">or <span className="font-medium text-blue-600">browse files</span></p>
                  <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) accept(f); e.target.value = ""; }} />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                    <FileText className="h-8 w-8 text-red-500" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-800">{file.name}</div>
                      <div className="text-xs text-slate-500">{fmtBytes(file.size)} · PDF{selectedSample ? ` · sample: ${selectedSample.title}` : ""}</div>
                    </div>
                    {!submitting && <button onClick={clear} aria-label="Remove file" className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"><X className="h-4 w-4" /></button>}
                  </div>
                  {progress !== null && (
                    <div>
                      <div className="mb-1 flex justify-between text-xs text-slate-500"><span>{progress < 100 ? "Uploading…" : "Upload complete. Starting run…"}</span><span>{progress}%</span></div>
                      <div className="h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} /></div>
                    </div>
                  )}
                  <div className="flex items-center justify-end gap-2">
                    <Button onClick={clear} disabled={submitting}>Choose another</Button>
                    <Button variant="primary" onClick={start} disabled={submitting}>
                      {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      {submitting ? "Starting…" : "Start processing"}
                    </Button>
                  </div>
                </div>
              )}
              {error && <div className="mt-4"><ErrorBanner message={error} /></div>}
            </div>
          </Card>
          {preview && (
            <Card>
              <CardHeader title="Document preview" />
              <object data={preview} type="application/pdf" className="h-[640px] w-full rounded-b-xl" aria-label="PDF preview">
                <p className="p-5 text-sm text-slate-500">Your browser can&apos;t display an inline PDF preview.</p>
              </object>
            </Card>
          )}
        </div>

        <Card className="h-fit lg:col-span-2">
          <CardHeader title="Sample invoices" subtitle="Real PDF files. One click loads one into the uploader." />
          <ul className="divide-y divide-slate-100">
            {samples.map((s) => (
              <li key={s.file}>
                <button onClick={() => loadSample(s)} disabled={submitting || !!loadingSample}
                  className={clsx("flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-slate-50 disabled:opacity-60", selectedSample?.file === s.file && "bg-blue-50/60")}>
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500">
                    {loadingSample === s.file ? <Loader2 className="h-4 w-4 animate-spin" /> : s.scanned ? <ScanLine className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-800">{s.title}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{s.scenario}</span>
                    <span className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">Expected: <StatusBadge status={s.expected} /></span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-slate-100 px-5 py-3 text-[11px] leading-relaxed text-slate-400">
            Processing the same invoice twice is caught as a duplicate. To replay the demo, use Settings → Reset demo runs.
          </div>
        </Card>
      </div>
    </>
  );
}
