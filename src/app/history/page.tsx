"use client";
import { useState } from "react";
import Link from "next/link";
import { UploadCloud } from "lucide-react";
import { Button, Card, PageHeader } from "@/components/ui";
import { RunsTable } from "@/components/runs-table";

export default function HistoryPage() {
  const [includeSamples, setIncludeSamples] = useState(true);
  return (
    <>
      <PageHeader
        title="Processing History"
        description="Every run is persisted, including failed ones. Open any run to see its full stage-by-stage report."
        actions={<Link href="/process"><Button variant="primary"><UploadCloud className="h-4 w-4" />Process invoice</Button></Link>}
      />
      <Card><RunsTable pageSize={15} includeSamples={includeSamples} onIncludeSamplesChange={setIncludeSamples} /></Card>
    </>
  );
}
