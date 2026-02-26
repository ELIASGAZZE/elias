// Tabs comunes que ven todos los usuarios
export const TABS_BASE = [
  { label: 'Nuevo Pedido', path: '/pedidos/nuevo' },
  { label: 'Pedidos', path: '/pedidos' },
]

// Tabs adicionales solo para admin
export const TABS_ADMIN = [
  { label: 'Art. ERP', path: '/admin/articulos' },
  { label: 'Art. Manual', path: '/admin/articulos-manuales' },
]

// Función que devuelve los tabs según el rol
export const getTabsParaRol = (esAdmin) => {
  if (esAdmin) return [...TABS_BASE, ...TABS_ADMIN]
  return TABS_BASE
}
