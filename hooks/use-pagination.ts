"use client"

import { useState, useEffect, useMemo } from "react"

interface UsePaginationProps<T> {
  data: T[]
  initialPage?: number
  initialItemsPerPage?: number
}

export function usePagination<T>({ data, initialPage = 1, initialItemsPerPage = 10 }: UsePaginationProps<T>) {
  const [currentPage, setCurrentPage] = useState(initialPage)
  const [itemsPerPage, setItemsPerPage] = useState(initialItemsPerPage)

  // Calcular el número total de páginas
  const totalPages = useMemo(() => Math.max(1, Math.ceil(data.length / itemsPerPage)), [data.length, itemsPerPage])

  // Resetear a la primera página cuando cambian los datos o el número de elementos por página
  useEffect(() => {
    setCurrentPage(1)
  }, [data.length, itemsPerPage])

  // Asegurarse de que la página actual es válida
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  // Obtener los datos paginados
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    return data.slice(startIndex, endIndex)
  }, [data, currentPage, itemsPerPage])

  return {
    currentPage,
    setCurrentPage,
    itemsPerPage,
    setItemsPerPage,
    totalPages,
    paginatedData,
  }
}
