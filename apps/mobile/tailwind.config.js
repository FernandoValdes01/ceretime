/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        student: {
          background: '#fbf9f8',
          surface: '#ffffff',
          muted: '#f5f3f3',
          text: '#1b1c1c',
          secondary: '#3e4946',
          primary: '#00695b',
          success: '#005045',
          outline: '#6e7a76',
          border: '#bdc9c5',
          error: '#ba1a1a',
          focus: '#2563eb',
        },
      },
    },
  },
  plugins: [],
};
