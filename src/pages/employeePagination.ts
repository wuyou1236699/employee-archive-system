export const EMPLOYEE_LIST_PAGE_SIZE = 12;

export function paginateEmployees<T>(items: T[], requestedPage: number) {
  const totalPages = Math.ceil(items.length / EMPLOYEE_LIST_PAGE_SIZE);
  const currentPage = totalPages === 0
    ? 1
    : Math.min(Math.max(requestedPage, 1), totalPages);
  const startIndex = totalPages === 0 ? 0 : (currentPage - 1) * EMPLOYEE_LIST_PAGE_SIZE;
  const endIndex = Math.min(startIndex + EMPLOYEE_LIST_PAGE_SIZE, items.length);

  return {
    items: items.slice(startIndex, endIndex),
    totalPages,
    currentPage,
    startIndex,
    endIndex,
  };
}
