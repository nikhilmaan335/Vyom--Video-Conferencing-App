// Password visibility toggle
document.addEventListener('DOMContentLoaded', function() {
    const passwordToggle = document.getElementById('password-toggle');
    const passwordInput = document.getElementById('password-input');

    if (passwordToggle && passwordInput) {
        passwordToggle.addEventListener('click', function() {
            if (passwordInput.type === 'password') {
                passwordInput.type = 'text';
                passwordToggle.textContent = '🔒';
            } else {
                passwordInput.type = 'password';
                passwordToggle.textContent = '👁️';
            }
        });
    }

    // Password validation function
    function validatePassword(password) {
        const requirements = {
            minLength: password.length >= 6,
            hasUppercase: /[A-Z]/.test(password),
            hasNumber: /\d/.test(password),
            hasSpecialChar: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>\/?]/.test(password)
        };

        return requirements;
    }

    // Check if password meets requirements
    function isPasswordValid(password) {
        const requirements = validatePassword(password);
        return requirements.minLength && requirements.hasUppercase && requirements.hasNumber && requirements.hasSpecialChar;
    }

    // Form submission handler
    const form = document.querySelector('.details form');
    if (form) {
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const firstName = form.fname.value;
            const lastName = form.lname.value;
            const email = form.email.value;
            const password = form.password.value;
            const termsAccepted = form.terms.checked;

            if (!termsAccepted) {
                alert('Please agree to the Terms and Conditions');
                return;
            }

            // Validate password
            if (!isPasswordValid(password)) {
                const requirements = validatePassword(password);
                let errorMsg = 'Password must contain:\n';
                
                if (!requirements.minLength) {
                    errorMsg += '✗ Minimum 6 characters\n';
                } else {
                    errorMsg += '✓ Minimum 6 characters\n';
                }
                
                if (!requirements.hasUppercase) {
                    errorMsg += '✗ At least one uppercase letter (A-Z)\n';
                } else {
                    errorMsg += '✓ At least one uppercase letter (A-Z)\n';
                }

                if (!requirements.hasNumber) {
                    errorMsg += '✗ At least one number (0-9)\n';
                } else {
                    errorMsg += '✓ At least one number (0-9)\n';
                }
                
                if (!requirements.hasSpecialChar) {
                    errorMsg += '✗ At least one special character (!@#$%^&*...)';
                } else {
                    errorMsg += '✓ At least one special character (!@#$%^&*...)';
                }

                alert(errorMsg);
                return;
            }

            console.log('Form Data:', {
                firstName,
                lastName,
                email,
                password,
                termsAccepted
            });

            alert(`Account creation requested for: ${email}`);
            // Add your form submission logic here
        });
    }

    // Social button handlers
    const socialButtons = document.querySelectorAll('.social-btn');
    socialButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            const provider = this.getAttribute('data-provider') || this.classList[1].replace('-btn', '');
            const action = window.location.pathname.includes('sign-in.html') ? 'sign in' : 'sign up';
            const messageBox = document.querySelector('.provider-message');

            console.log(`${action} with ${provider}`);

            const demoUser = {
                provider,
                email: `${provider.toLowerCase()}@demo.com`,
                name: `${provider} User`
            };

            localStorage.setItem('vyomAuthUser', JSON.stringify(demoUser));

            if (messageBox) {
                messageBox.textContent = `${provider} ${action} completed successfully.`;
            }

            renderAuthenticatedState(demoUser);
            alert(`Welcome ${demoUser.name}! You have successfully signed ${action === 'sign in' ? 'in' : 'up'} with ${provider}.`);
        });
    });

    function getAuthContainer() {
        return document.getElementById('auth-panel') || document.querySelector('.auth-card') || document.querySelector('.details');
    }

    function handleSignOut() {
        localStorage.removeItem('vyomAuthUser');
        window.location.reload();
    }

    function renderAuthenticatedState(user) {
        const panel = getAuthContainer();
        if (!panel) return;

        panel.innerHTML = `
            <div class="logged-in-state">
                <h3>Welcome back!</h3>
                <p>You are now signed in to Vyom.</p>
                <div class="welcome-card">
                    <strong>${user.name}</strong>
                    <span>${user.email}</span>
                </div>
                <div class="logged-in-state__actions">
                    <button type="button" class="signup-btn" onclick="location.reload()">Continue to Vyom</button>
                    <button type="button" class="secondary-btn" id="signout-btn">Sign Out</button>
                </div>
            </div>
        `;

        const signOutButton = document.getElementById('signout-btn');
        if (signOutButton) {
            signOutButton.addEventListener('click', handleSignOut);
        }
    }

    const storedUser = localStorage.getItem('vyomAuthUser');
    if (storedUser) {
        try {
            const parsedUser = JSON.parse(storedUser);
            renderAuthenticatedState(parsedUser);
        } catch (error) {
            console.error('Invalid stored user:', error);
        }
    }

    // Sign In form handler
    const signInForm = document.getElementById('signin-form');
    if (signInForm) {
        signInForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const email = document.getElementById('signin-email').value;
            const password = document.getElementById('signin-password').value;

            if (!email || !password) {
                alert('Please enter your email and password.');
                return;
            }

            const demoUser = {
                provider: 'Email',
                email,
                name: email.split('@')[0]
            };

            localStorage.setItem('vyomAuthUser', JSON.stringify(demoUser));
            renderAuthenticatedState(demoUser);
            alert(`Welcome back, ${demoUser.name}!`);
        });
    }
});
