document.addEventListener('DOMContentLoaded', () => {
    const chatWindow = document.getElementById('chatWindow');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    // Remove this line:
    // const typingStatus = document.getElementById('typingStatus');
    const contactsList = document.getElementById('contactsList');
    const addContactBtn = document.getElementById('addContactBtn');
    const addContactDialog = document.getElementById('addContactDialog');
    const addContactForm = document.getElementById('addContactForm');
    const cancelBtn = document.getElementById('cancelBtn');

    // Contact Management
    let aiContacts = JSON.parse(localStorage.getItem('aiContacts')) || [];
    let currentContact = null;

    function saveContacts() {
        localStorage.setItem('aiContacts', JSON.stringify(aiContacts));
    }

    // Add chat history storage
    let chatHistories = JSON.parse(localStorage.getItem('chatHistories')) || {};

    function saveChatHistories() {
        localStorage.setItem('chatHistories', JSON.stringify(chatHistories));
    }

    // Add smooth entrance animation for messages
    // Add this helper function after variable declarations
    function estimateTokens(text) {
        // Rough estimation: ~4 chars per token for English text
        return Math.ceil(text.length / 4);
    }

    // Update the addMessage function
    function addMessage(text, isUser = false, shouldSave = true, isSummarized = false) {
        if (!currentContact) return;  // Don't add messages if no contact is selected
        
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', isUser ? 'user-message' : 'bot-message');
        if (isSummarized) {
            messageDiv.classList.add('summarized');
        }
        messageDiv.style.opacity = '0';
        messageDiv.style.transform = 'translateY(20px)';
        
        // Calculate token count
        const tokenCount = estimateTokens(text);
        const timestamp = new Date().toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit', 
            hour12: true 
        });
        
        // Add message content with token count for AI messages
        const messageContent = isUser ? `
            <div class="message-content">${text}</div>
            <div class="message-info">
                <span class="timestamp">${timestamp}</span>
            </div>
        ` : `
            <div class="message-content">${text}</div>
            <div class="message-info">
                <span class="timestamp">${timestamp}</span>
                <span class="token-count">${tokenCount} tokens</span>
            </div>
        `;
        
        messageDiv.innerHTML = messageContent;
        chatWindow.appendChild(messageDiv);
        
        // Always save valid messages
        if (currentContact && shouldSave) {
            if (!chatHistories[currentContact.id]) {
                chatHistories[currentContact.id] = [];
            }
            chatHistories[currentContact.id].push({
                text,
                isUser,
                timestamp: new Date().toISOString(),
                tokenCount: isUser ? null : tokenCount // Save token count for AI messages
            });
            saveChatHistories();
        }

        // Trigger animation
        setTimeout(() => {
            messageDiv.style.transition = 'all 0.3s ease';
            messageDiv.style.opacity = '1';
            messageDiv.style.transform = 'translateY(0)';
        }, 50);
        
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    // Add at the top level of the script
    let currentRequestController = null;
    let conversationComplete = true;
    let lastMessageContact = null;

    // Replace the existing sendToAI function with this updated version
    async function sendToAI(message, contact) {
        try {
            // Cancel any existing request
            if (currentRequestController) {
                currentRequestController.abort();
            }
            
            // Create new abort controller for this request
            currentRequestController = new AbortController();
            const signal = currentRequestController.signal;
            
            // Remove this line:
            // typingStatus.textContent = `${contact.name} is thinking...`;
            const messages = [];
            
            if (contact.promptTemplate) {
                messages.push({ role: "system", content: contact.promptTemplate });
            }
            
            if (chatHistories[contact.id]) {
                const recentMessages = chatHistories[contact.id].slice(-5);
                recentMessages.forEach(msg => {
                    messages.push({
                        role: msg.isUser ? "user" : "assistant",
                        content: msg.text
                    });
                });
            }
            
            messages.push({ role: "user", content: message });

            const response = await fetch(contact.apiEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${contact.apiKey}`
                },
                body: JSON.stringify({
                    model: contact.model,
                    messages: messages,
                    max_tokens: contact.tokenLimit || 200  // Add this line
                }),
                signal // Add abort signal to fetch request
            });

            if (!response.ok) {
                throw new Error(`API Error: ${response.status}`);
            }

            const data = await response.json();
            let responseText = data.choices?.[0]?.message?.content || "Sorry, I couldn't process that response.";
            
            // Check if response needs summarization
            const estimatedTokens = Math.ceil(responseText.length / 4);
            if (estimatedTokens > (contact.tokenLimit || 200)) {
                // Create a summarization prompt that maintains the AI's role
                const summaryPrompt = `You need to summarize your previous response while maintaining your role and personality. 
                                     Original response length: ${estimatedTokens} tokens
                                     Target length: ${contact.tokenLimit} tokens
                                     Original response: ${responseText}
                                     Please provide a natural, coherent summary that captures the key points.`;
                
                const summaryResponse = await fetch(contact.apiEndpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${contact.apiKey}`
                    },
                    body: JSON.stringify({
                        model: contact.model,
                        messages: [
                            { role: "system", content: contact.promptTemplate },
                            { role: "user", content: summaryPrompt }
                        ],
                        max_tokens: contact.tokenLimit
                    })
                });

                if (summaryResponse.ok) {
                    const summaryData = await summaryResponse.json();
                    if (summaryData.choices?.[0]?.message?.content) {
                        return { 
                            text: summaryData.choices[0].message.content,
                            isSummarized: true
                        };
                    }
                }
            }
            
            return { 
                text: responseText,
                isSummarized: false
            };

        } catch (error) {
            if (error.name === 'AbortError') {
                // Request was aborted, do nothing
                return null;
            }
            console.error('AI API Error:', error);
            return `Error: ${error.message || 'Could not connect to AI service'}`;
        } finally {
            if (currentRequestController) {
                currentRequestController = null;
            }
            // Remove this line:
            // typingStatus.textContent = '';
        }
    }

    // Add this new function after the addMessage function
    async function addThinkingMessage(name = '') {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', 'bot-message', 'thinking');
        messageDiv.innerHTML = `
            ${name ? `<strong class="message-author">${name}</strong>` : ''}
            <div class="message-content">Thinking...</div>
        `;
        chatWindow.appendChild(messageDiv);
        chatWindow.scrollTop = chatWindow.scrollHeight;
        return messageDiv;
    }

    // Add this helper function after the other helper functions
    async function summarizeText(text, maxTokens) {
        try {
            const summary = await sendToAI(
                `Please summarize this response in a natural way to fit within ${maxTokens} tokens while maintaining the key points: ${text}`,
                currentContact
            );
            return summary;
        } catch (error) {
            console.error('Summarization error:', error);
            // Fallback to simple truncation if summarization fails
            const approxMaxLength = maxTokens * 4;
            return text.slice(0, approxMaxLength) + '...';
        }
    }

    // Update the handleSendMessage function
    async function handleSendMessage() {
        const message = messageInput.value.trim();
        if (!message || !currentContact) return;

        const currentContactId = currentContact.id; // Store current contact ID
        messageInput.value = '';
        
        // Add user message without saving yet
        addMessage(message, true, false);

        const thinkingMsg = await addThinkingMessage(currentContact.name);
        const response = await sendToAI(message, currentContact);
        thinkingMsg.remove();

        // Only save both messages if we're still on the same contact
        if (response && currentContact && currentContact.id === currentContactId) {
            // Save both messages now that we have the complete conversation
            if (!chatHistories[currentContact.id]) {
                chatHistories[currentContact.id] = [];
            }
            
            // Save user message
            chatHistories[currentContact.id].push({
                text: message,
                isUser: true,
                timestamp: new Date().toISOString()
            });
            
            // Save AI response
            chatHistories[currentContact.id].push({
                text: response.text,
                isUser: false,
                timestamp: new Date().toISOString()
            });
            
            saveChatHistories();
            
            // Display AI response
            addMessage(response.text, false, false);
        }
    }

    // Enhanced contact rendering with animation
    function renderContacts() {
        contactsList.innerHTML = '';
        aiContacts.forEach((contact, index) => {
            const contactDiv = document.createElement('div');
            contactDiv.classList.add('contact');
            contactDiv.setAttribute('data-contact-id', contact.id);
            if (currentContact && currentContact.id === contact.id) {
                contactDiv.classList.add('active');
            }
            
            contactDiv.innerHTML = `
                <img src="${contact.imageUrl || '../images/default.png'}" 
                     alt="${contact.name}"
                     onerror="this.src='../images/default.png'">
                <div class="contact-info">
                    <h3>${contact.name}</h3>
                    <p class="provider-info">${contact.modelProvider}</p>
                </div>
                <div class="contact-actions">
                    <button class="edit-contact" data-index="${index}">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="delete-contact" data-index="${index}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
            contactsList.appendChild(contactDiv);
            
            // Trigger animation with delay based on index
            setTimeout(() => {
                contactDiv.style.transition = 'all 0.3s ease';
                contactDiv.style.opacity = '1';
                contactDiv.style.transform = 'translateX(0)';
            }, index * 100);
        });

        if (!currentContact) {
            document.getElementById('currentContactName').textContent = 'Select a contact';
            document.getElementById('currentModel').textContent = '';
        }
    }

    function showEditDialog(contact) {
        const editDialog = document.createElement('div');
        editDialog.classList.add('dialog-overlay');
        editDialog.style.display = 'flex';
        
        editDialog.innerHTML = `
            <div class="dialog">
                <h2>Edit AI Contact</h2>
                <form id="editContactForm">
                    <div class="form-group">
                        <label for="editContactImage">Profile Image:</label>
                        <div class="image-upload-container">
                            <div class="image-upload-area" id="editImageUploadArea">
                                <i class="fas fa-cloud-upload-alt"></i>
                                <p>Drop image here or click to upload</p>
                                <input type="file" id="editContactImage" accept="image/*" style="display: none">
                            </div>
                            <div class="image-preview-container" style="display: none">
                                <img id="editImagePreview" class="image-preview" src="${contact.imageUrl || ''}" alt="Preview">
                                <button type="button" class="remove-image" id="editRemoveImage">
                                    <i class="fas fa-times"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="editContactName">Name:</label>
                        <input type="text" id="editContactName" value="${contact.name}" required>
                    </div>
                    <div class="form-group">
                        <label for="editModelProvider">Model Provider:</label>
                        <input type="text" id="editModelProvider" 
                               value="${contact.modelProvider || ''}"
                               placeholder="e.g., OpenAI, Anthropic, Claude" 
                               required>
                    </div>
                    <div class="form-group">
                        <label for="editModelName">AI Model:</label>
                        <input type="text" id="editModelName" value="${contact.model}" required>
                    </div>
                    <div class="form-group">
                        <label for="editApiEndpoint">API Endpoint:</label>
                        <input type="url" id="editApiEndpoint" value="${contact.apiEndpoint}" required>
                    </div>
                    <div class="form-group">
                        <label for="editApiKey">API Key:</label>
                        <input type="password" id="editApiKey" value="${contact.apiKey}" required>
                    </div>
                    <div class="form-group">
                        <label for="editPromptTemplate">Personality Prompt:</label>
                        <textarea id="editPromptTemplate" rows="4">${contact.promptTemplate || ''}</textarea>
                    </div>
                    <div class="form-group">
                        <label for="editTokenLimit">Maximum Response Tokens:</label>
                        <input type="number" id="editTokenLimit" 
                               value="${contact.tokenLimit || 200}" 
                               min="50" max="4000" required>
                        <small class="hint-text">Controls the maximum length of AI responses (50-4000)</small>
                    </div>
                    <div class="dialog-buttons">
                        <button type="button" class="cancel-btn">Cancel</button>
                        <button type="submit" class="save-btn">Save Changes</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(editDialog);

        // Setup image upload functionality for edit form
        const editImageHandler = setupImageUpload(
            editDialog.querySelector('#editImageUploadArea'),
            editDialog.querySelector('.image-preview-container'),
            editDialog.querySelector('#editImagePreview'),
            editDialog.querySelector('#editRemoveImage'),
            editDialog.querySelector('#editContactImage')
        );

        // Set current image if exists
        if (contact.imageUrl) {
            editImageHandler.setCurrentImage(contact.imageUrl);
        }

        const editForm = editDialog.querySelector('#editContactForm');
        const cancelBtn = editDialog.querySelector('.cancel-btn');

        cancelBtn.addEventListener('click', () => {
            editDialog.remove();
        });

        editForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            // Update contact with image from handler
            contact.imageUrl = editImageHandler.getCurrentImage() || '../images/default.png'; // Add default path
            contact.name = document.getElementById('editContactName').value;
            contact.modelProvider = document.getElementById('editModelProvider').value;
            contact.model = document.getElementById('editModelName').value;
            contact.apiEndpoint = document.getElementById('editApiEndpoint').value;
            contact.apiKey = document.getElementById('editApiKey').value;
            contact.promptTemplate = document.getElementById('editPromptTemplate').value;
            contact.tokenLimit = parseInt(document.getElementById('editTokenLimit').value, 10); // Add this line

            // Save changes
            saveContacts();
            renderContacts();

            // Update current chat if editing current contact
            if (currentContact && currentContact.id === contact.id) {
                document.getElementById('currentContactName').textContent = contact.name;
                document.getElementById('currentModel').textContent = contact.model;
            }

            // Show success notification
            const notification = document.createElement('div');
            notification.classList.add('notification');
            notification.textContent = 'Contact updated successfully';
            document.body.appendChild(notification);
            
            setTimeout(() => {
                notification.remove();
            }, 3000);

            editDialog.remove();
        });
    }

    // Update the startChat function
    async function startChat(contact) {
        // Cancel any pending request when switching contacts
        if (currentRequestController) {
            currentRequestController.abort();
            currentRequestController = null;
        }

        // Update clear button state first
        const clearChatBtn = document.getElementById('clearChatBtn');
        clearChatBtn.classList.remove('disabled');

        // Always clear the chat window first
        chatWindow.innerHTML = '';

        // Reset conversation state
        conversationComplete = true;
        currentContact = contact;
        lastMessageContact = null;

        // Update header info including profile image - Update path here
        document.getElementById('currentContactName').textContent = contact.name;
        document.getElementById('currentModel').textContent = contact.model;
        document.querySelector('.chat-header-profile').src = contact.imageUrl || '../images/default.png';
        document.querySelector('.chat-header-profile').alt = contact.name;
        
        // Only add personality toggle if there's a prompt template
        if (contact.promptTemplate) {
            const personalityToggle = document.createElement('div');
            personalityToggle.classList.add('personality-toggle');
            personalityToggle.innerHTML = `
                <div class="personality-header">
                    <span>AI Personality</span>
                    <i class="fas fa-chevron-down"></i>
                </div>
                <div class="personality-content">
                    ${contact.promptTemplate}
                </div>
            `;
            
            chatWindow.appendChild(personalityToggle);

            // Add toggle functionality
            const header = personalityToggle.querySelector('.personality-header');
            const content = personalityToggle.querySelector('.personality-content');
            
            header.addEventListener('click', () => {
                personalityToggle.classList.toggle('expanded');
                content.classList.toggle('expanded');
            });
        }

        // Load chat history
        if (chatHistories[contact.id] && chatHistories[contact.id].length > 0) {
            const messageContainer = document.createElement('div');
            messageContainer.classList.add('messages-container');
            chatWindow.appendChild(messageContainer);
            
            // Store welcome info in localStorage
            localStorage.setItem(`welcome_${contact.id}`, JSON.stringify({
                name: contact.name,
                promptTemplate: contact.promptTemplate,
                timestamp: new Date().toISOString()
            }));
            
            chatHistories[contact.id].forEach(message => {
                const messageDiv = document.createElement('div');
                messageDiv.classList.add('message', message.isUser ? 'user-message' : 'bot-message');
                
                // Format timestamp
                const timestamp = new Date(message.timestamp).toLocaleTimeString('en-US', { 
                    hour: 'numeric', 
                    minute: '2-digit', 
                    hour12: true 
                });

                // Include token count for AI messages
                messageDiv.innerHTML = message.isUser ? `
                    <div class="message-content">${message.text}</div>
                    <div class="message-info">
                        <span class="timestamp">${timestamp}</span>
                    </div>
                ` : `
                    <div class="message-content">${message.text}</div>
                    <div class="message-info">
                        <span class="timestamp">${timestamp}</span>
                        <span class="token-count">${message.tokenCount || estimateTokens(message.text)} tokens</span>
                    </div>
                `;
                
                messageContainer.appendChild(messageDiv);
            });
        } else {
            // Store initial welcome info
            localStorage.setItem(`welcome_${contact.id}`, JSON.stringify({
                name: contact.name,
                promptTemplate: contact.promptTemplate,
                timestamp: new Date().toISOString()
            }));
            
            // Add welcome message for new chats
            const welcomeDiv = document.createElement('div');
            welcomeDiv.classList.add('welcome-message');
            welcomeDiv.innerHTML = `
                <p>Connected to ${contact.name}</p>
                <span class="timestamp">${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</span>
            `;
            chatWindow.appendChild(welcomeDiv);
        }
        
        // Scroll to bottom after loading history
        setTimeout(() => {
            chatWindow.scrollTop = chatWindow.scrollHeight;
        }, 100);

        renderContacts();
    }

    // Event Listeners
    sendBtn.addEventListener('click', handleSendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSendMessage();
    });

    addContactBtn.addEventListener('click', () => {
        addContactDialog.style.display = 'flex';
    });

    cancelBtn.addEventListener('click', () => {
        addContactDialog.style.display = 'none';
        addContactForm.reset();
    });

    addContactForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const newContact = {
            id: Date.now().toString(), // Add unique ID
            imageUrl: addContactImageHandler.getCurrentImage() || '../images/default.png', // Add default path
            name: document.getElementById('contactName').value,
            modelProvider: document.getElementById('modelProvider').value,
            model: document.getElementById('modelName').value,
            apiEndpoint: document.getElementById('apiEndpoint').value,
            apiKey: document.getElementById('apiKey').value,
            promptTemplate: document.getElementById('promptTemplate').value,
            tokenLimit: parseInt(document.getElementById('tokenLimit').value, 10) // Add this line
        };
        aiContacts.push(newContact);
        saveContacts();
        renderContacts();
        addContactDialog.style.display = 'none';
        addContactForm.reset();
        startChat(newContact);
    });

    contactsList.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.edit-contact');
        const deleteBtn = e.target.closest('.delete-contact');
        const contactDiv = e.target.closest('.contact');

        if (editBtn) {
            const index = editBtn.dataset.index;
            showEditDialog(aiContacts[index]);
        } else if (deleteBtn) {
            const index = deleteBtn.dataset.index;
            if (currentContact === aiContacts[index]) {
                currentContact = null;
                chatWindow.innerHTML = '<div class="welcome-message"><p>Select a contact to start chatting</p></div>';
            }
            aiContacts.splice(index, 1);
            saveContacts();
            renderContacts();
        } else if (contactDiv && !editBtn && !deleteBtn) {
            const index = contactDiv.querySelector('.delete-contact').dataset.index;
            startChat(aiContacts[index]);
        }
    });

    // Mobile menu toggle
    const menuToggle = document.createElement('button');
    menuToggle.innerHTML = '<i class="fas fa-bars"></i>';
    menuToggle.classList.add('menu-toggle');
    document.querySelector('header').prepend(menuToggle);

    menuToggle.addEventListener('click', () => {
        document.querySelector('.contacts-sidebar').classList.toggle('active');
    });

    // Settings button
    document.getElementById('settingsBtn').addEventListener('click', () => {
        const settingsDialog = document.createElement('div');
        settingsDialog.classList.add('dialog-overlay');
        settingsDialog.style.display = 'flex';
        
        settingsDialog.innerHTML = `
            <div class="dialog settings-dialog">
                <h2>Settings</h2>
                <div class="settings-options">
                    <button class="settings-btn" data-action="clear-all-history">
                        <i class="fas fa-trash-alt"></i>
                        Clear All Chat Histories
                    </button>
                    <button class="settings-btn" data-action="edit-profile">
                        <i class="fas fa-user-edit"></i>
                        Edit Profile
                    </button>
                    <button class="settings-btn" data-action="notifications">
                        <i class="fas fa-bell"></i>
                        Notifications
                    </button>
                    <button class="settings-btn" data-action="privacy">
                        <i class="fas fa-shield-alt"></i>
                        Privacy
                    </button>
                    <button class="settings-btn" data-action="language">
                        <i class="fas fa-globe"></i>
                        Language
                    </button>
                </div>
                <div class="dialog-buttons">
                    <button class="cancel-btn">Close</button>
                </div>
            </div>
        `;

        document.body.appendChild(settingsDialog);

        // Handle settings options
        settingsDialog.addEventListener('click', async (e) => {
            if (e.target.classList.contains('cancel-btn')) {
                settingsDialog.remove();
                return;
            }

            const settingsBtn = e.target.closest('.settings-btn');
            if (settingsBtn) {
                const action = settingsBtn.dataset.action;
                
                if (action === 'clear-all-history') {
                    const confirmClear = confirm('Are you sure you want to clear ALL chat histories? This action cannot be undone.');
                    if (confirmClear) {
                        chatHistories = {};
                        localStorage.removeItem('chatHistories');
                        
                        if (currentContact) {
                            startChat(currentContact); // Restart the current chat
                        }
                        
                        const notification = document.createElement('div');
                        notification.classList.add('notification');
                        notification.textContent = 'All chat histories cleared successfully';
                        document.body.appendChild(notification);
                        setTimeout(() => notification.remove(), 3000);
                        
                        settingsDialog.remove();
                    }
                } else {
                    alert('This feature is coming soon!');
                }
            }
        });
    });

    // Load saved theme
    if (localStorage.getItem('theme') === 'light') {
        document.body.classList.add('light-theme');
    }

    // Add search functionality
    const searchBar = document.getElementById('searchContacts');
    
    function filterContacts(searchTerm) {
        const contacts = document.querySelectorAll('.contact');
        contacts.forEach(contact => {
            const name = contact.querySelector('h3').textContent.toLowerCase();
            const model = contact.querySelector('p').textContent.toLowerCase();
            const matches = name.includes(searchTerm) || model.includes(searchTerm);
            contact.classList.toggle('hidden', !matches);
        });
    }

    searchBar.addEventListener('input', (e) => {
        filterContacts(e.target.value.toLowerCase());
    });

    // Add image preview functionality
    function setupImagePreview(imageInput, previewElement) {
        imageInput.addEventListener('input', () => {
            const url = imageInput.value.trim();
            if (url) {
                // Create temporary image to test URL
                const tempImg = new Image();
                tempImg.onload = () => {
                    previewElement.src = url;
                    previewElement.classList.remove('error');
                };
                tempImg.onerror = () => {
                    previewElement.src = 'images/default.png';
                    previewElement.classList.add('error');
                };
                tempImg.src = url;
            } else {
                previewElement.src = 'images/default.png';
                previewElement.classList.remove('error');
            }
        });
    }

    // Setup image preview for add contact form
    setupImagePreview(
        document.getElementById('contactImage'),
        document.getElementById('imagePreview')
    );

    // Add this with your other event listeners in the DOMContentLoaded section
    document.getElementById('clearChatBtn').addEventListener('click', clearChat);

    // Initial render
    renderContacts();

    // Move the clearChat function inside DOMContentLoaded
    function clearChat() {
        if (!currentContact) return;

        const confirmClear = confirm('Are you sure you want to clear this chat? This cannot be undone.');
        if (confirmClear) {
            // Clear chat history for current contact
            chatHistories[currentContact.id] = [];
            saveChatHistories();

            // Get stored welcome info
            const welcomeInfo = JSON.parse(localStorage.getItem(`welcome_${currentContact.id}`));

            // Clear the chat window
            chatWindow.innerHTML = '';
            
            // 1. Add personality toggle first if there's a prompt template
            if (currentContact.promptTemplate) {
                const personalityToggle = document.createElement('div');
                personalityToggle.classList.add('personality-toggle');
                personalityToggle.innerHTML = `
                    <div class="personality-header">
                        <span>AI Personality</span>
                        <i class="fas fa-chevron-down"></i>
                    </div>
                    <div class="personality-content">
                        ${currentContact.promptTemplate}
                    </div>
                `;
                
                chatWindow.appendChild(personalityToggle);

                // Add toggle functionality
                const header = personalityToggle.querySelector('.personality-header');
                const content = personalityToggle.querySelector('.personality-content');
                
                header.addEventListener('click', () => {
                    personalityToggle.classList.toggle('expanded');
                    content.classList.toggle('expanded');
                });
            }

            // 2. Add welcome message from stored info
            const welcomeDiv = document.createElement('div');
            welcomeDiv.classList.add('welcome-message');
            welcomeDiv.innerHTML = `
                <p>Connected to ${currentContact.name}</p>
                <span class="timestamp">${new Date().toLocaleTimeString('en-US', { 
                    hour: 'numeric', 
                    minute: '2-digit', 
                    hour12: true 
                })}</span>
            `;
            chatWindow.appendChild(welcomeDiv);
            
            // Show notification
            const notification = document.createElement('div');
            notification.classList.add('notification');
            notification.textContent = 'Chat history cleared successfully';
            document.body.appendChild(notification);
            setTimeout(() => notification.remove(), 3000);
        }
    }

    // Add the event listener inside DOMContentLoaded
    document.getElementById('clearChatBtn').addEventListener('click', clearChat);

    // Initialize clear button state
    const clearChatBtn = document.getElementById('clearChatBtn');
    clearChatBtn.classList.add('disabled');
});

function setupImageUpload(uploadArea, previewContainer, previewImage, removeButton, inputElement) {
    let currentImage = null;

    function handleFile(file) {
        if (!file.type.startsWith('image/')) {
            alert('Please upload an image file');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            currentImage = e.target.result;
            previewImage.src = currentImage;
            previewContainer.style.display = 'block';
            uploadArea.style.display = 'none';
        };
        reader.readAsDataURL(file);
    }

    // Drag and drop
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('drag-over');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('drag-over');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    });

    // Click to upload
    uploadArea.addEventListener('click', () => {
        inputElement.click();
    });

    inputElement.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleFile(file);
    });

    // Remove image
    removeButton.addEventListener('click', () => {
        currentImage = null;
        previewImage.src = '';
        previewContainer.style.display = 'none';
        uploadArea.style.display = 'flex';
        inputElement.value = '';
    });

    return {
        getCurrentImage: () => currentImage,
        setCurrentImage: (imageData) => {
            if (imageData) {
                currentImage = imageData;
                previewImage.src = imageData;
                previewContainer.style.display = 'block';
                uploadArea.style.display = 'none';
            } else {
                currentImage = null;
                previewImage.src = '';
                previewContainer.style.display = 'none';
                uploadArea.style.display = 'flex';
            }
        }
    };
}

// Setup image upload for add contact form
const addContactImageHandler = setupImageUpload(
    document.getElementById('imageUploadArea'),
    document.querySelector('.image-preview-container'),
    document.getElementById('imagePreview'),
    document.getElementById('removeImage'),
    document.getElementById('contactImage')
);

// Update contact form submit handler
addContactForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const newContact = {
        id: Date.now().toString(),
        imageUrl: addContactImageHandler.getCurrentImage() || '../images/default.png', // Add default path
        name: document.getElementById('contactName').value,
        modelProvider: document.getElementById('modelProvider').value,
        model: document.getElementById('modelName').value,
        apiEndpoint: document.getElementById('apiEndpoint').value,
        apiKey: document.getElementById('apiKey').value,
        promptTemplate: document.getElementById('promptTemplate').value,
        tokenLimit: parseInt(document.getElementById('tokenLimit').value, 10) // Add this line
    };
    aiContacts.push(newContact);
    saveContacts();
    renderContacts();
    addContactDialog.style.display = 'none';
    addContactForm.reset();
    startChat(newContact);
});

// Update showEditDialog function
function showEditDialog(contact) {
    const editDialog = document.createElement('div');
    editDialog.classList.add('dialog-overlay');
    editDialog.style.display = 'flex';
    
    editDialog.innerHTML = `
        <div class="dialog">
            <h2>Edit AI Contact</h2>
            <form id="editContactForm">
                <div class="form-group">
                    <label for="editContactImage">Profile Image:</label>
                    <div class="image-upload-container">
                        <div class="image-upload-area" id="editImageUploadArea">
                            <i class="fas fa-cloud-upload-alt"></i>
                            <p>Drop image here or click to upload</p>
                            <input type="file" id="editContactImage" accept="image/*" style="display: none">
                        </div>
                        <div class="image-preview-container" style="display: none">
                            <img id="editImagePreview" class="image-preview" src="${contact.imageUrl || ''}" alt="Preview">
                            <button type="button" class="remove-image" id="editRemoveImage">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    </div>
                </div>
                <div class="form-group">
                    <label for="editContactName">Name:</label>
                    <input type="text" id="editContactName" value="${contact.name}" required>
                </div>
                <div class="form-group">
                    <label for="editModelProvider">Model Provider:</label>
                    <input type="text" id="editModelProvider" 
                           value="${contact.modelProvider || ''}"
                           placeholder="e.g., OpenAI, Anthropic, Claude" 
                           required>
                </div>
                <div class="form-group">
                    <label for="editModelName">AI Model:</label>
                    <input type="text" id="editModelName" value="${contact.model}" required>
                </div>
                <div class="form-group">
                    <label for="editApiEndpoint">API Endpoint:</label>
                    <input type="url" id="editApiEndpoint" value="${contact.apiEndpoint}" required>
                </div>
                <div class="form-group">
                    <label for="editApiKey">API Key:</label>
                    <input type="password" id="editApiKey" value="${contact.apiKey}" required>
                </div>
                <div class="form-group">
                    <label for="editPromptTemplate">Personality Prompt:</label>
                    <textarea id="editPromptTemplate" rows="4">${contact.promptTemplate || ''}</textarea>
                </div>
                <div class="form-group">
                    <label for="editTokenLimit">Maximum Response Tokens:</label>
                    <input type="number" id="editTokenLimit" 
                           value="${contact.tokenLimit || 200}" 
                           min="50" max="4000" required>
                    <small class="hint-text">Controls the maximum length of AI responses (50-4000)</small>
                </div>
                <div class="dialog-buttons">
                    <button type="button" class="cancel-btn">Cancel</button>
                    <button type="submit" class="save-btn">Save Changes</button>
                </div>
            </form>
        </div>
    `;

    document.body.appendChild(editDialog);

    // Setup image upload functionality for edit form
    const editImageHandler = setupImageUpload(
        editDialog.querySelector('#editImageUploadArea'),
        editDialog.querySelector('.image-preview-container'),
        editDialog.querySelector('#editImagePreview'),
        editDialog.querySelector('#editRemoveImage'),
        editDialog.querySelector('#editContactImage')
    );

    // Set current image if exists
    if (contact.imageUrl) {
        editImageHandler.setCurrentImage(contact.imageUrl);
    }

    const editForm = editDialog.querySelector('#editContactForm');
    const cancelBtn = editDialog.querySelector('.cancel-btn');

    cancelBtn.addEventListener('click', () => {
        editDialog.remove();
    });

    editForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        // Update contact with image from handler
        contact.imageUrl = editImageHandler.getCurrentImage() || '../images/default.png'; // Add default path
        contact.name = document.getElementById('editContactName').value;
        contact.modelProvider = document.getElementById('editModelProvider').value;
        contact.model = document.getElementById('editModelName').value;
        contact.apiEndpoint = document.getElementById('editApiEndpoint').value;
        contact.apiKey = document.getElementById('editApiKey').value;
        contact.promptTemplate = document.getElementById('editPromptTemplate').value;
        contact.tokenLimit = parseInt(document.getElementById('editTokenLimit').value, 10); // Add this line

        // Save changes
        saveContacts();
        renderContacts();

        // Update current chat if editing current contact
        if (currentContact && currentContact.id === contact.id) {
            document.getElementById('currentContactName').textContent = contact.name;
            document.getElementById('currentModel').textContent = contact.model;
        }

        // Show success notification
        const notification = document.createElement('div');
        notification.classList.add('notification');
        notification.textContent = 'Contact updated successfully';
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);

        editDialog.remove();
    });
}

// Update the initial header state
document.querySelector('.chat-header-text').classList.add('empty');

// Update the startChat function
async function startChat(contact) {
    // Cancel any pending request when switching contacts
    if (currentRequestController) {
        currentRequestController.abort();
        currentRequestController = null;
    }

    // Update clear button state first
    const clearChatBtn = document.getElementById('clearChatBtn');
    clearChatBtn.classList.remove('disabled');

    // Always clear the chat window first
    chatWindow.innerHTML = '';

    // Reset conversation state
    conversationComplete = true;
    currentContact = contact;
    lastMessageContact = null;

    // Update header info including profile image - Update path here
    const chatHeaderText = document.querySelector('.chat-header-text');
    chatHeaderText.classList.remove('empty');
    document.getElementById('currentContactName').textContent = contact.name;
    document.getElementById('currentModel').textContent = contact.model;
    document.querySelector('.chat-header-profile').src = contact.imageUrl || '../images/default.png';
    document.querySelector('.chat-header-profile').alt = contact.name;
    
    // Only add personality toggle if there's a prompt template
    if (contact.promptTemplate) {
        const personalityToggle = document.createElement('div');
        personalityToggle.classList.add('personality-toggle');
        personalityToggle.innerHTML = `
            <div class="personality-header">
                <span>AI Personality</span>
                <i class="fas fa-chevron-down"></i>
            </div>
            <div class="personality-content">
                ${contact.promptTemplate}
            </div>
        `;
        
        chatWindow.appendChild(personalityToggle);

        // Add toggle functionality
        const header = personalityToggle.querySelector('.personality-header');
        const content = personalityToggle.querySelector('.personality-content');
        
        header.addEventListener('click', () => {
            personalityToggle.classList.toggle('expanded');
            content.classList.toggle('expanded');
        });
    }

    // Load chat history
    if (chatHistories[contact.id] && chatHistories[contact.id].length > 0) {
        const messageContainer = document.createElement('div');
        messageContainer.classList.add('messages-container');
        chatWindow.appendChild(messageContainer);
        
        // Store welcome info in localStorage
        localStorage.setItem(`welcome_${contact.id}`, JSON.stringify({
            name: contact.name,
            promptTemplate: contact.promptTemplate,
            timestamp: new Date().toISOString()
        }));
        
        chatHistories[contact.id].forEach(message => {
            const messageDiv = document.createElement('div');
            messageDiv.classList.add('message', message.isUser ? 'user-message' : 'bot-message');
            
            // Format timestamp
            const timestamp = new Date(message.timestamp).toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit', 
                hour12: true 
            });

            // Include token count for AI messages
            messageDiv.innerHTML = message.isUser ? `
                <div class="message-content">${message.text}</div>
                <div class="message-info">
                    <span class="timestamp">${timestamp}</span>
                </div>
            ` : `
                <div class="message-content">${message.text}</div>
                <div class="message-info">
                    <span class="timestamp">${timestamp}</span>
                    <span class="token-count">${message.tokenCount || estimateTokens(message.text)} tokens</span>
                </div>
            `;
            
            messageContainer.appendChild(messageDiv);
        });
    } else {
        // Store initial welcome info
        localStorage.setItem(`welcome_${contact.id}`, JSON.stringify({
            name: contact.name,
            promptTemplate: contact.promptTemplate,
            timestamp: new Date().toISOString()
        }));
        
        // Add welcome message for new chats
        const welcomeDiv = document.createElement('div');
        welcomeDiv.classList.add('welcome-message');
        welcomeDiv.innerHTML = `
            <p>Connected to ${contact.name}</p>
            <span class="timestamp">${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</span>
        `;
        chatWindow.appendChild(welcomeDiv);
    }
    
    // Scroll to bottom after loading history
    setTimeout(() => {
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }, 100);

    renderContacts();
}

// Remove both existing clearChatBtn event listeners and replace with this:
function clearChat() {
    if (!currentContact) return;

    const confirmClear = confirm('Are you sure you want to clear this chat? This cannot be undone.');
    if (confirmClear) {
        // Clear chat history for current contact
        chatHistories[currentContact.id] = [];
        saveChatHistories();

        // Clear the chat window
        chatWindow.innerHTML = '';
        
        // 1. Add personality toggle first if there's a prompt template
        if (currentContact.promptTemplate) {
            const personalityToggle = document.createElement('div');
            personalityToggle.classList.add('personality-toggle');
            personalityToggle.innerHTML = `
                <div class="personality-header">
                    <span>AI Personality</span>
                    <i class="fas fa-chevron-down"></i>
                </div>
                <div class="personality-content">
                    ${currentContact.promptTemplate}
                </div>
            `;
            
            chatWindow.appendChild(personalityToggle);

            // Add toggle functionality
            const header = personalityToggle.querySelector('.personality-header');
            const content = personalityToggle.querySelector('.personality-content');
            
            header.addEventListener('click', () => {
                personalityToggle.classList.toggle('expanded');
                content.classList.toggle('expanded');
            });
        }

        // 2. Add welcome message from stored info
        const welcomeDiv = document.createElement('div');
        welcomeDiv.classList.add('welcome-message');
        welcomeDiv.innerHTML = `
            <p>Connected to ${currentContact.name}</p>
            <span class="timestamp">${new Date().toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit', 
                hour12: true 
            })}</span>
        `;
        chatWindow.appendChild(welcomeDiv);
        
        // Show notification
        const notification = document.createElement('div');
        notification.classList.add('notification');
        notification.textContent = 'Chat history cleared successfully';
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 3000);
    }
}

// Add this with your other event listeners
document.getElementById('clearChatBtn').addEventListener('click', clearChat);
