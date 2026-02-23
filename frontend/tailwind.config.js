/** @type {import('tailwindcss').Config} */
export default {
  // Tailwind escanea estos archivos para generar solo los estilos que se usan
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      // Podés personalizar colores de tu empresa acá
      colors: {
        primario: {
          50:  '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
      },
    },
  },
  plugins: [],
}
