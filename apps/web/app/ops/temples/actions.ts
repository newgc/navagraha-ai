'use server';

import { revalidatePath } from 'next/cache';
import { api, errorText } from '@/lib/api';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_BYTES = 5 * 1024 * 1024;

export interface ImportState {
  error?: string;
  report?: {
    applied: boolean;
    errors: number;
    warnings: number;
    counts: Record<string, number>;
    issues: {
      sheet: string;
      row?: number;
      column?: string;
      severity: 'error' | 'warning';
      message: string;
    }[];
  };
  fileName?: string;
}

/** Sends the workbook to the API: "check" only validates, "import" writes when there are no errors. */
export async function uploadWorkbook(_: ImportState, form: FormData): Promise<ImportState> {
  const file = form.get('workbook');
  const apply = form.get('mode') === 'import';
  if (!(file instanceof File) || file.size === 0)
    return { error: 'Choose the temple data workbook (.xlsx) first' };
  if (file.size > MAX_BYTES) return { error: 'The file is larger than 5 MB' };
  if (!file.name.toLowerCase().endsWith('.xlsx'))
    return { error: 'Upload the .xlsx workbook, not another file type' };
  const r = await api<NonNullable<ImportState['report']>>(
    `/admin/temple-data/import?fileName=${encodeURIComponent(file.name)}${apply ? '&apply=true' : ''}`,
    { method: 'POST', raw: { bytes: new Uint8Array(await file.arrayBuffer()), contentType: XLSX } },
  );
  if (!r.ok) return { error: errorText(r.error), fileName: file.name };
  if (r.data.applied) revalidatePath('/ops/temples');
  return { report: r.data, fileName: file.name };
}
