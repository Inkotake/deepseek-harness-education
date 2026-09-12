// A launcher stand-in for the driver's tests: exits at once with a distinctive code, so a test can
// prove the driver got PAST the credential skip without launching a real (slow, networked) session.
process.exit(7)
