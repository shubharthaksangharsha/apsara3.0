// Apsara AI Frontend JavaScript

// Global utility functions
function showAlert(type, message, duration = 5000) {
    // Handle error objects properly
    if (typeof message === 'object') {
        if (message.error) {
            message = message.error;
        } else if (message.message) {
            message = message.message;
        } else {
            message = JSON.stringify(message);
        }
    }
    
    // Ensure message is a string
    message = String(message || 'Unknown error');
    
    // Remove existing alerts
    document.querySelectorAll('.alert-auto').forEach(alert => alert.remove());
    
    // Create new alert
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show alert-auto`;
    alertDiv.style.position = 'fixed';
    alertDiv.style.top = '80px';
    alertDiv.style.right = '20px';
    alertDiv.style.zIndex = '9999';
    alertDiv.style.minWidth = '300px';
    alertDiv.style.maxWidth = '500px';
    
    const iconMap = {
        'success': 'bi-check-circle-fill',
        'error': 'bi-exclamation-triangle-fill',
        'warning': 'bi-exclamation-triangle-fill',
        'info': 'bi-info-circle-fill'
    };
    
    alertDiv.innerHTML = `
        <div class="d-flex align-items-center">
            <i class="bi ${iconMap[type] || 'bi-info-circle-fill'} me-2"></i>
            <div class="flex-grow-1">${message}</div>
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        </div>
    `;
    
    document.body.appendChild(alertDiv);
    
    // Auto-remove after duration
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
        }
    }, duration);
    
    return alertDiv;
}

// API helper functions
async function makeApiRequest(endpoint, options = {}) {
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
        }
    };
    
    const config = { ...defaultOptions, ...options };
    
    try {
        const response = await fetch(endpoint, config);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || `HTTP error! status: ${response.status}`);
        }
        
        return data;
    } catch (error) {
        console.error('API request failed:', error);
        throw error;
    }
}

// Authentication helpers
function isAuthenticated() {
    // This would check session or token in a real implementation
    return document.querySelector('nav .dropdown') !== null;
}

function getCurrentUser() {
    // Extract user info from the page (from server-side template)
    const userDropdown = document.querySelector('nav .dropdown-toggle');
    if (userDropdown) {
        return {
            name: userDropdown.textContent.trim(),
            isGuest: userDropdown.querySelector('.badge') !== null
        };
    }
    return null;
}

// Loading states
function setLoadingState(element, loading, originalText = null) {
    if (loading) {
        element.disabled = true;
        element.dataset.originalText = originalText || element.innerHTML;
        element.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Loading...';
    } else {
        element.disabled = false;
        element.innerHTML = element.dataset.originalText || originalText || element.innerHTML;
    }
}

// Form validation helpers
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function validatePassword(password) {
    return password.length >= 6;
}

function validateForm(formElement) {
    const inputs = formElement.querySelectorAll('input[required], textarea[required], select[required]');
    let isValid = true;
    
    inputs.forEach(input => {
        const value = input.value.trim();
        
        // Remove previous validation classes
        input.classList.remove('is-invalid', 'is-valid');
        
        if (!value) {
            input.classList.add('is-invalid');
            isValid = false;
        } else {
            // Additional validation based on input type
            if (input.type === 'email' && !validateEmail(value)) {
                input.classList.add('is-invalid');
                isValid = false;
            } else if (input.type === 'password' && !validatePassword(value)) {
                input.classList.add('is-invalid');
                isValid = false;
            } else {
                input.classList.add('is-valid');
            }
        }
    });
    
    return isValid;
}

// File handling utilities
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFileIcon(mimeType) {
    if (!mimeType) return 'bi-file-earmark';
    
    const typeMap = {
        'image/': 'bi-file-earmark-image',
        'audio/': 'bi-file-earmark-music',
        'video/': 'bi-file-earmark-play',
        'application/pdf': 'bi-file-earmark-pdf',
        'text/': 'bi-file-earmark-text',
        'application/msword': 'bi-file-earmark-word',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'bi-file-earmark-word',
        'application/vnd.ms-excel': 'bi-file-earmark-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'bi-file-earmark-excel',
        'application/vnd.ms-powerpoint': 'bi-file-earmark-ppt',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'bi-file-earmark-ppt'
    };
    
    for (const [type, icon] of Object.entries(typeMap)) {
        if (mimeType.startsWith(type) || mimeType === type) {
            return icon;
        }
    }
    
    return 'bi-file-earmark';
}

function validateFile(file, maxSize = 100 * 1024 * 1024) { // 100MB default
    const allowedTypes = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'audio/mpeg', 'audio/wav', 'audio/mp3', 'audio/ogg',
        'video/mp4', 'video/avi', 'video/mov', 'video/webm',
        'application/pdf', 'text/plain', 'text/csv',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    
    if (!allowedTypes.includes(file.type)) {
        return { valid: false, error: 'File type not supported' };
    }
    
    if (file.size > maxSize) {
        return { valid: false, error: `File size exceeds ${formatFileSize(maxSize)} limit` };
    }
    
    return { valid: true };
}

// UI utilities
function toggleElementVisibility(element, show = null) {
    if (show === null) {
        show = element.style.display === 'none';
    }
    
    element.style.display = show ? 'block' : 'none';
}

function scrollToElement(element, behavior = 'smooth') {
    element.scrollIntoView({ behavior, block: 'start' });
}

function copyToClipboard(text) {
    if (navigator.clipboard) {
        return navigator.clipboard.writeText(text);
    } else {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            return successful ? Promise.resolve() : Promise.reject();
        } catch (err) {
            document.body.removeChild(textArea);
            return Promise.reject(err);
        }
    }
}

// Debounce utility
function debounce(func, wait, immediate) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            timeout = null;
            if (!immediate) func.apply(this, args);
        };
        const callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(this, args);
    };
}

// Local storage helpers
function saveToLocalStorage(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify(data));
        return true;
    } catch (error) {
        console.error('Failed to save to localStorage:', error);
        return false;
    }
}

function loadFromLocalStorage(key, defaultValue = null) {
    try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : defaultValue;
    } catch (error) {
        console.error('Failed to load from localStorage:', error);
        return defaultValue;
    }
}

function removeFromLocalStorage(key) {
    try {
        localStorage.removeItem(key);
        return true;
    } catch (error) {
        console.error('Failed to remove from localStorage:', error);
        return false;
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

function initializeApp() {
    // Initialize tooltips if Bootstrap is available
    if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
        const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
        tooltipTriggerList.map(function (tooltipTriggerEl) {
            return new bootstrap.Tooltip(tooltipTriggerEl);
        });
    }
    
    // Initialize form validation
    const forms = document.querySelectorAll('.needs-validation');
    forms.forEach(form => {
        form.addEventListener('submit', function(event) {
            if (!form.checkValidity() || !validateForm(form)) {
                event.preventDefault();
                event.stopPropagation();
            }
            form.classList.add('was-validated');
        });
    });
    
    // Auto-focus first input in modals
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        modal.addEventListener('shown.bs.modal', function() {
            const firstInput = modal.querySelector('input, textarea, select');
            if (firstInput) {
                firstInput.focus();
            }
        });
    });
    
    // Auto-resize textareas
    const textareas = document.querySelectorAll('textarea[data-auto-resize]');
    textareas.forEach(textarea => {
        const resizeTextarea = () => {
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';
        };
        
        textarea.addEventListener('input', resizeTextarea);
        resizeTextarea(); // Initial resize
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', function(event) {
        // Ctrl/Cmd + Enter to submit forms
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            const activeForm = document.activeElement.closest('form');
            if (activeForm) {
                const submitButton = activeForm.querySelector('button[type="submit"]');
                if (submitButton && !submitButton.disabled) {
                    submitButton.click();
                }
            }
        }
        
        // Escape to close modals
        if (event.key === 'Escape') {
            const openModal = document.querySelector('.modal.show');
            if (openModal && typeof bootstrap !== 'undefined') {
                const modal = bootstrap.Modal.getInstance(openModal);
                if (modal) {
                    modal.hide();
                }
            }
        }
    });
    
    // Handle network status
    window.addEventListener('online', function() {
        showAlert('success', 'Connection restored', 3000);
    });
    
    window.addEventListener('offline', function() {
        showAlert('warning', 'Connection lost. Some features may not work.', 5000);
    });
    
    console.log('Apsara AI Frontend initialized');
}

// Error handling
window.addEventListener('error', function(event) {
    console.error('Global error:', event.error);
    
    // Don't show error alerts for script loading errors in production
    if (window.location.hostname !== 'localhost' && event.filename) {
        return;
    }
    
    // Show user-friendly error for API failures
    if (event.error && event.error.message && event.error.message.includes('fetch')) {
        showAlert('error', 'Network error. Please check your connection and try again.');
    }
});

window.addEventListener('unhandledrejection', function(event) {
    console.error('Unhandled promise rejection:', event.reason);
    
    // Handle specific promise rejections
    if (event.reason && typeof event.reason === 'object') {
        if (event.reason.message && event.reason.message.includes('fetch')) {
            showAlert('error', 'Failed to connect to server. Please try again.');
            event.preventDefault(); // Prevent the error from being logged to console
        }
    }
});

// Export utilities for use in other scripts
window.ApsaraUtils = {
    showAlert,
    makeApiRequest,
    isAuthenticated,
    getCurrentUser,
    setLoadingState,
    validateEmail,
    validatePassword,
    validateForm,
    formatFileSize,
    getFileIcon,
    validateFile,
    toggleElementVisibility,
    scrollToElement,
    copyToClipboard,
    debounce,
    saveToLocalStorage,
    loadFromLocalStorage,
    removeFromLocalStorage
};