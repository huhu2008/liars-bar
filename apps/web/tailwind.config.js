/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bar: {
          900: '#0f0803',
          800: '#1a0f07',
          700: '#25150b',
          600: '#331d0f',
        },
        brass: {
          400: '#e0b062',
          500: '#c8923f',
          600: '#9a6d2a',
        },
      },
      fontFamily: {
        display: ['"PingFang SC"', '"Noto Serif SC"', 'serif'],
      },
      boxShadow: {
        card: '0 10px 20px -8px rgba(0,0,0,0.9)',
        seat: '0 0 0 1px rgba(224,176,98,0.25), 0 12px 30px -12px rgba(0,0,0,0.95)',
      },
    },
  },
  plugins: [],
};
