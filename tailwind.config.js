/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './content/**/*.{md,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#0ea5e9',
          dark: '#0369a1',
        },
      },
      boxShadow: {
        card: '0 8px 24px rgba(0,0,0,0.06)',
      },
      borderRadius: {
        xl: '12px',
      }
    },
  },
  plugins: [],
}

