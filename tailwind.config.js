import animate from 'tailwindcss-animate'

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      keyframes: {
        'eyes-blink': {
          '0%, 90%, 100%': { top: '-100%' },
          '95%': { top: '0%' },
        },
        'eyes-look': {
          '0%, 100%': { transform: 'translate(-50%, -50%)' },
          '25%': { transform: 'translate(calc(-50% - 8px), calc(-50% + 4px))' },
          '50%': { transform: 'translate(calc(-50% + 8px), calc(-50% - 4px))' },
          '75%': { transform: 'translate(calc(-50% + 4px), calc(-50% + 8px))' },
        },
        'rest-breathe': {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.3' },
          '50%': { transform: 'scale(1.5)', opacity: '0.6' },
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(20px) scale(0.95)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'border-pulse': {
          '0%, 100%': { borderColor: 'hsl(var(--primary) / 0.1)', boxShadow: '0 0 0 0px hsl(var(--primary) / 0)' },
          '50%': { borderColor: 'hsl(var(--primary) / 0.4)', boxShadow: '0 0 20px 2px hsl(var(--primary) / 0.2)' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'bounce-in': {
          '0%': { transform: 'scale(0.3)', opacity: '0' },
          '50%': { transform: 'scale(1.05)', opacity: '1' },
          '70%': { transform: 'scale(0.9)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: {
        'eyes-blink': 'eyes-blink var(--eyes-blink-duration, 4s) infinite',
        'eyes-look': 'eyes-look var(--eyes-look-duration, 8s) infinite',
        'rest-breathe': 'rest-breathe 8s ease-in-out infinite',
        'fade-in-up': 'fade-in-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'border-pulse': 'border-pulse 3s infinite ease-in-out',
        'float': 'float 6s infinite ease-in-out',
        'bounce-in': 'bounce-in 0.8s cubic-bezier(0.68, -0.55, 0.265, 1.55) forwards',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
    },
  },
  plugins: [animate],
}

