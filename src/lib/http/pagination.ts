export type PaginationParams = {
  page: number;
  pageSize: number;
  from: number;
  to: number;
};

export function getPaginationFromUrl(
  url: string,
  options?: { defaultPageSize?: number; maxPageSize?: number }
): PaginationParams {
  const { defaultPageSize = 50, maxPageSize = 200 } = options ?? {};
  const searchParams = new URL(url).searchParams;

  const pageRaw = Number(searchParams.get("page") ?? "1");
  const pageSizeRaw = Number(searchParams.get("pageSize") ?? searchParams.get("limit") ?? String(defaultPageSize));

  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const unclampedPageSize =
    Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? Math.floor(pageSizeRaw) : defaultPageSize;
  const pageSize = Math.min(Math.max(1, unclampedPageSize), maxPageSize);

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  return { page, pageSize, from, to };
}

export function getPaginationMeta(total: number, page: number, pageSize: number) {
  const safeTotal = Number.isFinite(total) && total >= 0 ? total : 0;
  const totalPages = safeTotal === 0 ? 0 : Math.ceil(safeTotal / pageSize);
  return { total: safeTotal, page, pageSize, totalPages };
}
