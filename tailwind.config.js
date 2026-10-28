/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // 業者品牌色（僅作為名稱縮寫徽章使用，不代表官方 Logo）
        kmb: {
          DEFAULT: '#d81e06',
          soft: '#fee9e5',
          ink: '#8c1403',
        },
        ctb: {
          DEFAULT: '#f5b700',
          soft: '#fff6d6',
          ink: '#7a5a00',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          "'Segoe UI'",
          "'PingFang HK'",
          "'Noto Sans TC'",
          "'Microsoft JhengHei'",
          'system-ui',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.06), 0 12px 24px -18px rgba(15, 23, 42, 0.45)',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.6s linear infinite',
        'fade-in': 'fade-in 0.2s ease-out',
      },
    },
  },
  plugins: [],
}


