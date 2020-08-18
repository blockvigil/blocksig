module.exports = {
	purge: {
		enabled: true,
		content: ['./src/**/*.html'],
	},
	theme: {
		extend: {},
	},
	variants: {},
	plugins: [
		require('@tailwindcss/ui'),
	]
}
