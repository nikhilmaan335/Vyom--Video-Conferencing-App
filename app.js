// Theme toggle and password visibility
document.addEventListener('DOMContentLoaded', function() {
    const themeToggleBtn = document.getElementById('theme-toggle');
    const savedTheme = localStorage.getItem('vyomTheme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light');

    function setTheme(theme) {
        document.documentElement.dataset.theme = theme;
        localStorage.setItem('vyomTheme', theme);
        if (themeToggleBtn) {
            themeToggleBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
        }
    }

    setTheme(initialTheme);

    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', function() {
            const currentTheme = document.documentElement.dataset.theme || 'light';
            setTheme(currentTheme === 'dark' ? 'light' : 'dark');
        });
    }

    const passwordToggle = document.getElementById('password-visibility-toggle');
    const passwordInput = document.getElementById('password-input-field');

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
    const signupForm = document.querySelector('.signup-panel form');
    if (signupForm) {
        signupForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const firstName = signupForm.fname.value;
            const lastName = signupForm.lname.value;
            const email = signupForm.email.value;
            const password = signupForm.password.value;
            const termsAccepted = signupForm.terms.checked;

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

            const user = {
                provider: 'Email',
                email,
                name: `${firstName} ${lastName}`.trim() || email.split('@')[0]
            };

            alert(`Welcome ${user.name}! Your account has been created.`);
            redirectToDashboard(user);
        });
    }

    // Social button handlers
    const socialButtons = document.querySelectorAll('.social-button');
    socialButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            const provider = this.getAttribute('data-provider') || this.classList[1].replace('-btn', '');
            const action = window.location.pathname.includes('sign-in.html') ? 'sign in' : 'sign up';
            const messageBox = document.querySelector('.provider-feedback');

            console.log(`${action} with ${provider}`);

            const demoUser = {
                provider,
                email: `${provider.toLowerCase()}@demo.com`,
                name: `${provider} User`
            };

            if (messageBox) {
                messageBox.textContent = `${provider} ${action} completed successfully.`;
            }

            redirectToDashboard(demoUser);
            alert(`Welcome ${demoUser.name}! You have successfully signed ${action === 'sign in' ? 'in' : 'up'} with ${provider}.`);
        });
    });

    function getAuthContainer() {
        return document.getElementById('auth-panel') || document.querySelector('.auth-panel-card') || document.querySelector('.signup-panel');
    }

    function saveUser(user) {
        localStorage.setItem('vyomAuthUser', JSON.stringify(user));
    }

    function handleSignOut() {
        localStorage.removeItem('vyomAuthUser');
        window.location.href = 'sign-in.html';
    }

    function renderAuthenticatedState(user) {
        const panel = getAuthContainer();
        if (!panel) return;

        panel.innerHTML = `
            <div class="signed-in-state">
                <h3>Welcome back!</h3>
                <p>You are now signed in to Vyom.</p>
                <div class="welcome-panel">
                    <strong>${user.name}</strong>
                    <span>${user.email}</span>
                </div>
                <div class="signed-in-state__actions">
                    <button type="button" class="primary-button" onclick="location.href='dashboard.html'">Continue to Dashboard</button>
                    <button type="button" class="secondary-button" id="sign-out-button">Sign Out</button>
                </div>
            </div>
        `;

        const signOutButton = document.getElementById('sign-out-button');
        if (signOutButton) {
            signOutButton.addEventListener('click', handleSignOut);
        }
    }

    function redirectToDashboard(user) {
        saveUser(user);
        console.log('Redirecting to dashboard for user:', user);
        window.location.href = 'dashboard.html';
    }

    function initializeDashboardInteractions(user) {
        const userNameElement = document.getElementById('dashboard-username');
        if (userNameElement) {
            userNameElement.textContent = user.name || user.email.split('@')[0];
        }

        const userEmailElement = document.getElementById('dashboard-email');
        if (userEmailElement) {
            userEmailElement.textContent = user.email;
        }

        const profileName = document.querySelector('.profile-name');
        const profileEmail = document.querySelector('.profile-email');
        if (profileName) {
            profileName.textContent = user.name || user.email.split('@')[0];
        }
        if (profileEmail) {
            profileEmail.textContent = user.email;
        }

        const dashboardNavLinks = document.querySelectorAll('.sidebar-nav .nav-link');
        dashboardNavLinks.forEach(link => {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                dashboardNavLinks.forEach(item => item.classList.remove('active'));
                this.classList.add('active');
                const section = this.dataset.target;
                if (section && section !== 'dashboard') {
                    const title = section.replace('-', ' ');
                    alert(`Opening ${title}...`);
                }
            });
        });

        const searchButton = document.getElementById('meeting-search-button');
        const searchInput = document.getElementById('meeting-search');
        if (searchButton && searchInput) {
            searchButton.addEventListener('click', function() {
                const query = searchInput.value.trim();
                if (!query) {
                    alert('Please enter a search term first.');
                    return;
                }
                alert(`Searching meetings for "${query}"`);
            });
        }

        const newMeetingButton = document.getElementById('new-meeting-button');
        if (newMeetingButton) {
            newMeetingButton.addEventListener('click', function() {
                alert('Create a new meeting from your meetings overview.');
            });
        }

        const joinMeetingButton = document.getElementById('join-meeting-button');
        const meetingCodeInput = document.getElementById('meeting-code');
        if (joinMeetingButton && meetingCodeInput) {
            joinMeetingButton.addEventListener('click', function() {
                const code = meetingCodeInput.value.trim();
                if (!code) {
                    alert('Please enter a meeting code or link.');
                    return;
                }
                alert(`Joining meeting: ${code}`);
            });
        }

        const signOutButton = document.getElementById('dashboard-sign-out-button');
        if (signOutButton) {
            signOutButton.addEventListener('click', handleSignOut);
        }
    }

    function renderDashboard(user) {
        initializeDashboardInteractions(user);
    }

    const storedUser = localStorage.getItem('vyomAuthUser');
    const isDashboardPage = window.location.pathname.includes('dashboard.html');

    if (storedUser) {
        try {
            const parsedUser = JSON.parse(storedUser);
            if (isDashboardPage) {
                renderDashboard(parsedUser);
            } else {
                window.location.href = 'dashboard.html';
            }
        } catch (error) {
            console.error('Invalid stored user:', error);
            if (isDashboardPage) {
                window.location.href = 'sign-in.html';
            }
        }
    } else if (isDashboardPage) {
        window.location.href = 'sign-in.html';
    }

    // Sign In form handler
    const signInForm = document.getElementById('sign-in-form');
    if (signInForm) {
        signInForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const email = document.getElementById('sign-in-email').value.trim();
            const password = document.getElementById('sign-in-password').value;

            if (!email || !password) {
                alert('Please enter your email and password.');
                return;
            }

            const demoUser = {
                provider: 'Email',
                email,
                name: email.split('@')[0]
            };

            redirectToDashboard(demoUser);
        });
    }
});
