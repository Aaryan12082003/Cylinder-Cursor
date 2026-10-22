import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type UiState = {
  collapsed: boolean
  paletteOpen: boolean
  toggleCollapsed: () => void
  setCollapsed: (collapsed: boolean) => void
  setPaletteOpen: (open: boolean) => void
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      collapsed: false,
      paletteOpen: false,
      toggleCollapsed: () => set((state) => ({ collapsed: !state.collapsed })),
      setCollapsed: (collapsed) => set({ collapsed }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    }),
    { name: 'cylinderflow-ui', partialize: (state) => ({ collapsed: state.collapsed }) },
  ),
)
