/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/app/web/**/*.{vue,ts,js}'],
  theme: {
    screens: {
      xs: '480px',
      sm: '600px',
      md: '840px',
      lg: '960px',
      xl: '1280px',
    },
    extend: {
      fontFamily: {
        sans: ["'Albert Sans'", 'sans-serif'],
      },
      colors: {
        primary: '#f0b800',
        red: '#e03020',
        surface: '#1a1a1a',
        'surface-elevated': '#242424',
        border: '#333333',
        muted: '#666666',
        bright: '#ffffff',
        'text-primary': '#cccccc',
        danger: '#e03020',
      },
    },
  },
  plugins: [],
}
