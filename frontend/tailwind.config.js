/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        sidebar: '#212023',
        highlight: '#D4FF3F',
        preview: '#E1E1E1',
      },
    },
  },
  plugins: [],
}
