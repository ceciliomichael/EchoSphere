document.addEventListener('DOMContentLoaded', async () => {
    // Add empty class to header initially
    document.querySelector('.chat-header-text').classList.add('empty');

    // Get stored contacts and groups
    const aiContacts = JSON.parse(localStorage.getItem('aiContacts')) || [];
    let groups = JSON.parse(localStorage.getItem('aiGroups')) || [];
    let currentGroup = null;
    let groupMessages = await loadGroupMessages();

    // Add these new variables at the top
    let isAutoChatEnabled = false;
    let autoChatInterval = null;
    const MIN_INTERVAL = 3000; // 3 seconds
    const MAX_INTERVAL = 6000; // 6 seconds

    // Add these variables after the existing ones
    let chatIntervals = {
        min: 3000,
        max: 6000,
        responseChance: 0.7 // Base chance of responding
    };

    // Change from const to let
    let MAX_TOKENS = 200; // Default max tokens per message
    const MAX_CONTEXT_MESSAGES = 5; // Number of recent messages to keep for context

    // Update the settings loading
    const savedSettings = JSON.parse(localStorage.getItem('chatSettings'));
    if (savedSettings) {
        chatIntervals.min = savedSettings.minInterval;
        chatIntervals.max = savedSettings.maxInterval;
    }

    // Add this helper function after the variable declarations
    function estimateTokens(text) {
        // Rough estimation: ~4 chars per token for English text
        return Math.ceil(text.length / 4);
    }

    // Remove truncateMessage function as we'll use summarization instead

    // Add this helper function for analyzing message sentiment/content
    function analyzeMessage(message) {
        const indicators = {
            isQuestion: /\?/.test(message),
            hasTechnicalTerms: /\b(code|programming|javascript|python|api|data|algorithm)\b/i.test(message),
            isGreeting: /\b(hi|hello|hey|greetings)\b/i.test(message),
            isOpinion: /\b(think|believe|feel|opinion|consider)\b/i.test(message),
            hasEmotion: /\b(happy|sad|angry|excited|interesting|curious)\b/i.test(message)
        };
        return indicators;
    }

    // Add this helper function for managing chat context
    function createChatContext(members, recentMessages) {
        const uniqueParticipants = members.map(ai => ({
            name: ai.name,
            role: ai.promptTemplate.split('.')[0], // Get the first sentence of their role
            expertise: ai.promptTemplate.toLowerCase().match(/expertise in ([^.]+)/)?.[1] || ''
        }));

        return {
            participants: uniqueParticipants,
            conversation: recentMessages
        };
    }

    // DOM elements
    const groupsList = document.getElementById('groupsList');
    const chatWindow = document.getElementById('chatWindow');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const addGroupBtn = document.getElementById('addGroupBtn');
    const createGroupDialog = document.getElementById('createGroupDialog');
    const createGroupForm = document.getElementById('createGroupForm');
    const cancelBtn = document.getElementById('cancelBtn');
    const membersList = document.getElementById('membersList');

    function saveGroups() {
        localStorage.setItem('aiGroups', JSON.stringify(groups));
    }

    // Add these helper functions for conversation persistence
    const conversationStorage = {
        async save(groupId, messages) {
            try {
                // Save to localStorage as backup
                localStorage.setItem(`group_${groupId}_messages`, JSON.stringify(messages));
                
                // Save to file
                await saveGroupMessages({
                    ...groupMessages,
                    [groupId]: messages
                });
            } catch (error) {
                console.error('Error saving conversation:', error);
            }
        },

        async load(groupId) {
            try {
                // Try to load from file first
                const allMessages = await loadGroupMessages();
                if (allMessages[groupId]) {
                    return allMessages[groupId];
                }

                // If not in file, try localStorage
                const stored = localStorage.getItem(`group_${groupId}_messages`);
                return stored ? JSON.parse(stored) : [];
            } catch (error) {
                console.error('Error loading conversation:', error);
                return [];
            }
        }
    };

    // Update the saveGroupMessages function
    async function saveGroupMessages(messages) {
        try {
            const data = {
                messages,
                lastUpdate: new Date().toISOString()
            };
            
            // Save to both localStorage and file
            localStorage.setItem('groupMessages', JSON.stringify(data));
            
            const response = await fetch('../data/group_messages.json', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data, null, 2)
            });

            if (!response.ok) throw new Error('Failed to save messages');
        } catch (error) {
            console.error('Error saving messages:', error);
            // Still save to localStorage as backup
            localStorage.setItem('groupMessages', JSON.stringify({
                messages,
                lastUpdate: new Date().toISOString()
            }));
        }
    }

    function renderGroups() {
        groupsList.innerHTML = '';
        groups.forEach(group => {
            const groupDiv = document.createElement('div');
            groupDiv.classList.add('group-item');
            if (currentGroup && currentGroup.id === group.id) {
                groupDiv.classList.add('active');
            }
            
            groupDiv.innerHTML = `
                <div class="group-avatar">
                    <i class="fas fa-users"></i>
                </div>
                <div class="group-info">
                    <h3>${group.name}</h3>
                    <p>${group.members.length} members</p>
                </div>
                <div class="group-actions">
                    <button class="delete-group-btn" title="Delete Group">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
            
            const deleteBtn = groupDiv.querySelector('.delete-group-btn');
            
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Are you sure you want to delete "${group.name}"?`)) {
                    deleteGroup(group.id);
                }
            });
            
            groupDiv.addEventListener('click', () => startGroupChat(group));
            groupsList.appendChild(groupDiv);
        });
    }

    function deleteGroup(groupId) {
        groups = groups.filter(g => g.id !== groupId);
        delete groupMessages[groupId];
        saveGroups();
        saveGroupMessages(groupMessages);
        
        if (currentGroup && currentGroup.id === groupId) {
            currentGroup = null;
            chatWindow.innerHTML = '';
            document.getElementById('currentGroupName').textContent = 'Select a group';
            document.getElementById('memberCount').textContent = '';
            updateAutoChatButtonState(); // Update button state after group deletion
        }
        
        renderGroups();
    }

    function renderMembersList() {
        membersList.innerHTML = '';
        aiContacts.forEach(contact => {
            const memberDiv = document.createElement('div');
            memberDiv.classList.add('member-option');
            memberDiv.innerHTML = `
                <label>
                    <input type="checkbox" value="${contact.id}">
                    <img src="${contact.imageUrl || 'images/default.png'}" alt="${contact.name}">
                    <span>${contact.name}</span>
                </label>
            `;
            membersList.appendChild(memberDiv);
        });

        updateMemberCount();
    }

    async function refreshContacts() {
        const refreshBtn = document.getElementById('refreshContacts');
        refreshBtn.classList.add('spinning');
        
        try {
            // Get contacts from localStorage instead of JSON file
            const storedContacts = JSON.parse(localStorage.getItem('aiContacts')) || [];
            if (storedContacts.length === 0) {
                throw new Error('No contacts found');
            }
            
            aiContacts.length = 0; // Clear existing contacts
            aiContacts.push(...storedContacts);
            
            renderMembersList();
            
            // Show success notification
            const notification = document.createElement('div');
            notification.classList.add('notification');
            notification.textContent = 'Contacts refreshed successfully';
            document.body.appendChild(notification);
            setTimeout(() => notification.remove(), 3000);
        } catch (error) {
            console.error('Error refreshing contacts:', error);
            // Show error notification
            const notification = document.createElement('div');
            notification.classList.add('notification', 'error');
            notification.textContent = 'No contacts found. Please add contacts in the main chat first.';
            document.body.appendChild(notification);
            setTimeout(() => notification.remove(), 3000);
        } finally {
            refreshBtn.classList.remove('spinning');
        }
    }

    function updateMemberCount() {
        const selectedCount = membersList.querySelectorAll('input[type="checkbox"]:checked').length;
        document.querySelector('.members-count').textContent = `${selectedCount} selected`;
    }

    // Add this function near the other helper functions
    async function summarizeResponse(text, contact, maxTokens) {
        try {
            const summaryResponse = await fetch(contact.apiEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${contact.apiKey}`
                },
                body: JSON.stringify({
                    model: contact.model,
                    messages: [
                        { 
                            role: "system", 
                            content: `${contact.promptTemplate}\nAdditional instruction: Summarize while maintaining the same tone and personality.`
                        },
                        {
                            role: "user",
                            content: `Please summarize this response to fit within ${maxTokens} tokens while maintaining the key points and your personality:\n\n${text}`
                        }
                    ],
                    max_tokens: maxTokens
                })
            });

            if (summaryResponse.ok) {
                const data = await summaryResponse.json();
                return data.choices?.[0]?.message?.content;
            }
            return null;
        } catch (error) {
            console.error('Summarization error:', error);
            return null;
        }
    }

    // Add this new function after other helper functions
    async function createSmartSummary(text, contact, maxTokens) {
        try {
            // Create a more sophisticated summarization prompt
            const summaryPrompt = `You need to rewrite the following response to fit within ${maxTokens} tokens while:
1. Maintaining your personality and role as ${contact.name}
2. Preserving key information and technical details
3. Keeping the same tone and emotion
4. Ensuring the response remains natural and conversational

Original text to summarize:
${text}

Important: Your response should be a direct continuation of the conversation, not a meta-description of the summary.`;

            const summaryResponse = await fetch(contact.apiEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${contact.apiKey}`
                },
                body: JSON.stringify({
                    model: contact.model,
                    messages: [
                        { 
                            role: "system", 
                            content: contact.promptTemplate 
                        },
                        {
                            role: "user",
                            content: summaryPrompt
                        }
                    ],
                    max_tokens: maxTokens,
                    temperature: 0.7
                })
            });

            if (!summaryResponse.ok) {
                throw new Error('Summary API request failed');
            }

            const data = await summaryResponse.json();
            return data.choices?.[0]?.message?.content || null;
        } catch (error) {
            console.error('Smart summarization error:', error);
            return null;
        }
    }

    // Update the sendToAI function
    async function sendToAI(message, aiContact, context = []) {
        // Load token overrides
        const tokenOverrides = JSON.parse(localStorage.getItem('groupTokenOverrides')) || {
            enabled: false,
            limits: {}
        };

        // Calculate effective token limit first
        const effectiveTokenLimit = Math.floor(
            (tokenOverrides.enabled && tokenOverrides.limits[aiContact.id]
                ? tokenOverrides.limits[aiContact.id]
                : (aiContact.tokenLimit || 200)) * 0.95
        );

        try {
            const messages = [];
            
            // Add system prompt with enhanced context awareness
            if (aiContact.promptTemplate) {
                messages.push({ 
                    role: "system", 
                    content: `${aiContact.promptTemplate}\nYou are participating in a group chat. Maintain conversation context and engage naturally with other participants.`
                });
            }
            
            // Format context messages properly
            if (Array.isArray(context)) {
                context.forEach(msg => {
                    messages.push({
                        role: "assistant",
                        content: msg
                    });
                });
            }
            
            // Add the user message
            messages.push({ role: "user", content: message });

            const requestBody = {
                model: aiContact.model,
                messages: messages,
                max_tokens: effectiveTokenLimit,
                temperature: 0.7,
                presence_penalty: 0.6,
                frequency_penalty: 0.5
            };

            const response = await fetch(aiContact.apiEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${aiContact.apiKey}`
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error('API Error Details:', errorData);
                throw new Error(`API Error: ${response.status}`);
            }

            const data = await response.json();
            if (!data.choices?.[0]?.message?.content) {
                throw new Error('Invalid API response format');
            }

            let responseText = data.choices[0].message.content;
            const estimatedTokens = estimateTokens(responseText);

            if (estimatedTokens > effectiveTokenLimit) {
                console.log(`Response exceeds token limit (${estimatedTokens}/${effectiveTokenLimit}), summarizing...`);
                
                // Try smart summarization first
                const smartSummary = await createSmartSummary(responseText, aiContact, effectiveTokenLimit);
                
                if (smartSummary && estimateTokens(smartSummary) <= effectiveTokenLimit) {
                    return smartSummary;
                }

                // Fallback to basic summarization if smart summary fails or is too long
                const basicSummary = await summarizeResponse(responseText, aiContact, effectiveTokenLimit);
                if (basicSummary) {
                    return basicSummary;
                }

                // Last resort: truncate with ellipsis
                const approxMaxLength = effectiveTokenLimit * 4;
                const truncated = responseText.slice(0, approxMaxLength) + '...';
                console.log('Falling back to truncation');
                return truncated;
            }
            
            return responseText;
        } catch (error) {
            console.error('AI API Error:', error);
            return `Error connecting to ${aiContact.name}: ${error.message}`;
        }
    }

    // Update the handleGroupMessage function
    async function handleGroupMessage(message, group) {
        if (!message.trim() || !group) return;

        // Disable auto-chat immediately when user sends a message
        if (isAutoChatEnabled) {
            toggleAutoChat();
            return new Promise(resolve => {
                // Wait for auto-chat to fully disable before continuing
                setTimeout(async () => {
                    await processSingleMessage(message, group);
                    resolve();
                }, 100);
            });
        } else {
            await processSingleMessage(message, group);
        }
    }

    // Add this new helper function to handle single message processing
    async function processSingleMessage(message, group) {
        try {
            await addGroupMessage(message, 'You', true);

            const recentMessages = (groupMessages[currentGroup.id] || [])
                .slice(-MAX_CONTEXT_MESSAGES)
                .map(msg => msg.text);

            for (const memberId of group.members) {
                const member = aiContacts.find(c => c.id === memberId);
                if (!member) continue;

                try {
                    const thinkingMsg = await addThinkingMessage(member.name);
                    const prompt = `Current conversation context:
                        ${recentMessages.join('\n')}
                        
                        User's message: ${message}
                        
                        You are ${member.name}. ${member.promptTemplate}
                        Remember:
                        1. Do not prefix your response with your name or any labels
                        2. Respond naturally as part of the conversation
                        3. Keep your unique personality and expertise
                        4. Engage directly with what was said

                        Your response:`;

                    const response = await sendToAI(prompt, member);
                    
                    if (thinkingMsg?.parentNode) {
                        thinkingMsg.remove();
                    }

                    if (response) {
                        const cleanResponse = response.replace(/^([^:]+: )|^["']|["']$/g, '').trim();
                        await addGroupMessage(cleanResponse, member.name, false);
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                } catch (error) {
                    console.error(`Error getting response from ${member.name}:`, error);
                    await addGroupMessage(
                        `I apologize, but I'm having trouble responding right now.`, 
                        member.name, 
                        false
                    );
                }
            }
        } catch (error) {
            console.error('Error in processSingleMessage:', error);
        }
    }

    // Update the addGroupMessage function
    async function addGroupMessage(text, author, isUser = false, save = true) {
        if (!currentGroup || !text) return null;

        try {
            // Normalize the text before processing
            const normalizedText = TextNormalizer.cleanResponse(
                TextNormalizer.normalizeQuotes(text)
            );

            const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const timestamp = new Date().toISOString();
            const isSystemMessage = author === 'System';
            const tokenCount = estimateTokens(normalizedText);
            
            // Check for recent duplicate messages
            if (groupMessages[currentGroup.id]?.some(msg => 
                msg.text === normalizedText && 
                msg.author === author && 
                Date.now() - new Date(msg.timestamp).getTime() < 1000
            )) {
                return null;
            }

            const messageDiv = document.createElement('div');
            messageDiv.classList.add('message', isUser ? 'user-message' : 'bot-message');
            messageDiv.setAttribute('data-message-id', messageId);
            
            // Only show token count if it's not a system message
            messageDiv.innerHTML = `
                <strong class="message-author">${author}</strong>
                <div class="message-content">${normalizedText}</div>
                <div class="message-info">
                    <span class="timestamp">${new Date(timestamp).toLocaleTimeString('en-US', { 
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true 
                    })}</span>
                    ${!isSystemMessage ? `<span class="token-count">${tokenCount} tokens</span>` : ''}
                </div>
            `;

            // Ensure chatWindow exists before appending
            const chatWindow = document.getElementById('chatWindow');
            if (chatWindow) {
                chatWindow.appendChild(messageDiv);
                chatWindow.scrollTop = chatWindow.scrollHeight;
            }

            if (save) {
                // Initialize messages array if it doesn't exist
                if (!groupMessages[currentGroup.id]) {
                    groupMessages[currentGroup.id] = [];
                }
                
                // Add new message
                const messageData = {
                    id: messageId,
                    text: normalizedText,
                    author,
                    isUser,
                    timestamp,
                    tokenCount
                };
                
                groupMessages[currentGroup.id].push(messageData);
                
                // Save to storage
                await conversationStorage.save(currentGroup.id, groupMessages[currentGroup.id]);
            }

            return messageDiv;
        } catch (error) {
            console.error('Error in addGroupMessage:', error);
            return null;
        }
    }

    // Add this new function for conversation starters
    const conversationStarters = [
        "What are your thoughts on artificial intelligence and its future?",
        "How do you think technology will change in the next decade?",
        "What's the most interesting development in your field recently?",
        "If you could solve one global challenge, what would it be?",
        "What's your perspective on human-AI collaboration?",
        "How do you envision the future of work?",
        "What emerging technologies excite you the most?",
        "What are the ethical considerations we should keep in mind with AI?",
    ];

    // Update initiateAutoChat function
    async function initiateAutoChat() {
        if (!currentGroup || !isAutoChatEnabled) return;

        try {
            const initiator = selectInitiator();
            if (!initiator) return;

            const recentMessages = (groupMessages[currentGroup.id] || [])
                .slice(-MAX_CONTEXT_MESSAGES)
                .map(msg => `${msg.author}: ${msg.text}`);

            const chatContext = {
                participants: currentGroup.members
                    .map(id => aiContacts.find(c => c.id === id))
                    .filter(Boolean)
                    .map(ai => ({
                        name: ai.name,
                        role: ai.promptTemplate.split('.')[0]
                    }))
            };

            const prompt = `You are in a group chat conversation as ${initiator.name}.
                ${initiator.promptTemplate}

                Current participants:
                ${chatContext.participants.map(p => `- ${p.name}`).join('\n')}

                Recent conversation:
                ${recentMessages.length > 0 ? recentMessages.join('\n') : 
                `Start a new conversation about: ${conversationStarters[Math.floor(Math.random() * conversationStarters.length)]}`}

                Instructions:
                1. Be conversational and engaging
                2. Do not prefix your response with your name
                3. Stay in character as ${initiator.name}
                4. Engage with other participants
                5. Keep responses natural and contextual

                Your response:`;

            const thinkingMsg = await addThinkingMessage(initiator.name);
            const response = await sendToAI(prompt, initiator, recentMessages);
            
            if (thinkingMsg && thinkingMsg.parentNode) {
                thinkingMsg.remove();
            }

            if (response && isAutoChatEnabled) {
                const cleanResponse = response.replace(/^([^:]+: )|^["']|["']$/g, '').trim();
                await addGroupMessage(cleanResponse, initiator.name, false);
                
                // Trigger responses from other AIs
                await processAIResponses(cleanResponse, initiator);
            }
        } catch (error) {
            console.error('Auto-chat initiation error:', error);
        }
    }

    // Add new helper functions
    function selectInitiator() {
        const members = currentGroup.members
            .map(id => aiContacts.find(c => c.id === id))
            .filter(Boolean);
        
        // Weight AIs based on their recent participation and personality
        const weighted = members.map(ai => {
            let weight = 1;
            const recentMessages = groupMessages[currentGroup.id]?.slice(-10) || [];
            
            // Reduce weight if AI spoke recently
            const lastSpoke = recentMessages.reverse().findIndex(m => m.author === ai.name);
            if (lastSpoke !== -1) {
                weight -= (0.1 * (10 - lastSpoke));
            }
            
            // Increase weight for more conversational personalities
            const personality = ai.promptTemplate?.toLowerCase() || '';
            if (personality.includes('social') || personality.includes('chatty')) weight += 0.3;
            if (personality.includes('expert') || personality.includes('teacher')) weight += 0.2;
            
            return { ai, weight: Math.max(0.1, weight) };
        });
        
        // Select randomly based on weights
        const totalWeight = weighted.reduce((sum, { weight }) => sum + weight, 0);
        let random = Math.random() * totalWeight;
        
        for (const { ai, weight } of weighted) {
            random -= weight;
            if (random <= 0) return ai;
        }
        
        return weighted[0]?.ai;
    }

    async function addThinkingMessage(author) {
        if (!chatWindow) return null;
        
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', 'bot-message', 'thinking');
        messageDiv.innerHTML = `
            <strong class="message-author">${author}</strong>
            <div class="message-content">Thinking...</div>
        `;
        chatWindow.appendChild(messageDiv);
        chatWindow.scrollTop = chatWindow.scrollHeight;
        
        // Return promise that resolves with the message element
        return messageDiv;
    }

    // Update processAIResponses function
    async function processAIResponses(message, initiator) {
        if (!isAutoChatEnabled || !currentGroup) return;

        try {
            const messageIndicators = analyzeMessage(message);
            const otherMembers = currentGroup.members
                .filter(id => id !== initiator.id)
                .map(id => aiContacts.find(c => c.id === id))
                .filter(Boolean);

            const recentMessages = (groupMessages[currentGroup.id] || [])
                .slice(-MAX_CONTEXT_MESSAGES)
                .map(msg => `${msg.author}: ${msg.text}`);

            recentMessages.push(`${initiator.name}: ${message}`);

            // Process each member's response with proper delays
            for (const member of otherMembers) {
                let responseChance = chatIntervals.responseChance;
                
                // Calculate response chance
                if (messageIndicators.isQuestion) responseChance += 0.2;
                if (messageIndicators.hasTechnicalTerms && member.promptTemplate.toLowerCase().includes('technical')) responseChance += 0.3;
                if (messageIndicators.isGreeting && member.promptTemplate.toLowerCase().includes('friendly')) responseChance += 0.2;
                if (message.toLowerCase().includes(member.name.toLowerCase())) responseChance += 0.4;

                if (Math.random() < responseChance) {
                    // Ensure minimum delay between responses
                    const minDelay = Math.max(chatIntervals.min, 2000); // At least 2 seconds
                    const maxDelay = Math.max(chatIntervals.max, minDelay + 2000); // At least 2 seconds more than min
                    const delay = Math.random() * (maxDelay - minDelay) + minDelay;

                    // Wait for the calculated delay
                    await new Promise(resolve => setTimeout(resolve, delay));
                    
                    if (!isAutoChatEnabled) return; // Check if still enabled after delay

                    const prompt = `You are participating in a group chat conversation.

                        Recent messages:
                        ${recentMessages.join('\n')}

                        You are ${member.name}. ${member.promptTemplate}

                        Instructions:
                        1. Respond naturally to the ongoing conversation
                        2. Do not prefix your response with your name
                        3. Stay in character as ${member.name}
                        4. If you have nothing relevant to add, respond with "NO_RESPONSE"
                        5. Engage with what others have said

                        Your response:`;

                    const thinkingMsg = await addThinkingMessage(member.name);
                    const response = await sendToAI(prompt, member, recentMessages);
                    
                    if (thinkingMsg?.parentNode) {
                        thinkingMsg.remove();
                    }

                    if (response && !response.includes('NO_RESPONSE')) {
                        const cleanResponse = response.replace(/^([^:]+: )|^["']|["']$/g, '').trim();
                        await addGroupMessage(cleanResponse, member.name, false);
                    }
                }
            }

            // Schedule next conversation round with proper delay
            if (isAutoChatEnabled) {
                clearTimeout(autoChatInterval);
                const baseDelay = chatIntervals.max * 2; // Double the max interval for conversation rounds
                const participantFactor = otherMembers.length * 0.5; // Add more delay based on participant count
                const nextDelay = baseDelay + (baseDelay * participantFactor) + Math.random() * 3000;
                autoChatInterval = setTimeout(initiateAutoChat, nextDelay);
            }
        } catch (error) {
            console.error('Error in processAIResponses:', error);
        }
    }

    // Update the startGroupChat function
    async function startGroupChat(group) {
        if (isAutoChatEnabled) {
            toggleAutoChat();
        }

        currentGroup = group;
        document.getElementById('currentGroupName').textContent = group.name;
        document.getElementById('memberCount').textContent = `${group.members.length} members`;
        
        // Update clear button state
        document.getElementById('clearChatBtn').classList.remove('disabled');
        
        chatWindow.innerHTML = '';
        
        // Add welcome message with members list first
        const memberNames = group.members
            .map(id => aiContacts.find(c => c.id === id)?.name)
            .filter(Boolean)
            .join(', ');

        const welcomeDiv = document.createElement('div');
        welcomeDiv.classList.add('welcome-message');
        welcomeDiv.innerHTML = `
            <p>Connected to ${memberNames}</p>
            <span class="timestamp">${new Date().toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit', 
                hour12: true 
            })}</span>
        `;
        chatWindow.appendChild(welcomeDiv);
        
        try {
            // Load saved messages for this group
            const savedMessages = await conversationStorage.load(group.id);
            
            if (savedMessages && savedMessages.length > 0) {
                // Update groupMessages
                groupMessages[group.id] = savedMessages;
                
                // Display messages
                savedMessages
                    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
                    .forEach(msg => {
                        addGroupMessage(msg.text, msg.author, msg.isUser, false);
                    });
            }
        } catch (error) {
            console.error('Error loading group chat:', error);
            addGroupMessage('Error loading previous messages.', 'System', false);
        }
        
        renderGroups();
        updateAutoChatButtonState();
        
        // Update header with group info
        const chatHeaderText = document.querySelector('.chat-header-text');
        chatHeaderText.classList.remove('empty');
        document.getElementById('currentGroupName').textContent = group.name;
        document.getElementById('memberCount').textContent = `${group.members.length} members`;
    }

    // Update the showSettingsDialog function
    function showSettingsDialog() {
        // Load saved token overrides
        const tokenOverrides = JSON.parse(localStorage.getItem('groupTokenOverrides')) || {
            enabled: false,
            limits: {}
        };
        
        const settingsDialog = document.createElement('div');
        settingsDialog.classList.add('dialog-overlay');
        settingsDialog.style.display = 'flex';
        
        settingsDialog.innerHTML = `
            <div class="dialog settings-dialog">
                <div class="dialog-header">
                    <h2><i class="fas fa-cog fa-spin-hover"></i> Chat Settings</h2>
                </div>
                <div class="settings-content">
                    <div class="form-group">
                        <label>Response Intervals</label>
                        <div class="interval-controls">
                            <label>Min:</label>
                            <input type="range" id="minInterval" 
                                   min="1" max="10" step="0.5"
                                   value="${chatIntervals.min / 1000}">
                            <span class="interval-display" id="minIntervalDisplay">
                                ${chatIntervals.min / 1000}s
                            </span>
                        </div>
                        <div class="interval-controls">
                            <label>Max:</label>
                            <input type="range" id="maxInterval" 
                                   min="2" max="15" step="0.5"
                                   value="${chatIntervals.max / 1000}">
                            <span class="interval-display" id="maxIntervalDisplay">
                                ${chatIntervals.max / 1000}s
                            </span>
                        </div>
                    </div>

                    <div class="token-override-section">
                        <div class="token-toggle">
                            <label>Override Contact Token Limits</label>
                            <label class="token-toggle-switch">
                                <input type="checkbox" id="tokenOverrideToggle" ${tokenOverrides.enabled ? 'checked' : ''}>
                                <span class="token-toggle-slider"></span>
                            </label>
                        </div>
                        <div class="token-limits ${tokenOverrides.enabled ? 'active' : ''}">
                            <p class="hint-text">Set custom token limits for group chat responses</p>
                            <div class="contact-token-list">
                                ${aiContacts.map(contact => `
                                    <div class="contact-token-item">
                                        <div class="contact-token-info">
                                            <div class="contact-token-name">${contact.name}</div>
                                            <div class="contact-token-model">${contact.model}</div>
                                        </div>
                                        <input type="number" 
                                               class="contact-token-input" 
                                               data-contact-id="${contact.id}"
                                               value="${tokenOverrides.limits[contact.id] || contact.tokenLimit || 200}"
                                               min="50" 
                                               max="4000">
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                </div>
                <div class="dialog-buttons">
                    <button type="button" class="cancel-btn">Cancel</button>
                    <button type="button" class="save-btn">Save Changes</button>
                </div>
            </div>
        `;

        document.body.appendChild(settingsDialog);

        // Add token override toggle handler
        const tokenOverrideToggle = settingsDialog.querySelector('#tokenOverrideToggle');
        const tokenLimitsSection = settingsDialog.querySelector('.token-limits');
        
        tokenOverrideToggle.addEventListener('change', () => {
            tokenLimitsSection.classList.toggle('active', tokenOverrideToggle.checked);
        });

        // Setup interval controls
        const minInterval = settingsDialog.querySelector('#minInterval');
        const maxInterval = settingsDialog.querySelector('#maxInterval');
        const minDisplay = settingsDialog.querySelector('#minIntervalDisplay');
        const maxDisplay = settingsDialog.querySelector('#maxIntervalDisplay');

        function updateIntervalDisplays() {
            const minVal = parseFloat(minInterval.value);
            const maxVal = parseFloat(maxInterval.value);
            
            minDisplay.textContent = `${minVal.toFixed(1)}s`;
            maxDisplay.textContent = `${maxVal.toFixed(1)}s`;
            
            // Ensure max is always greater than min
            if (minVal >= maxVal) {
                maxInterval.value = (minVal + 0.5).toString();
                maxDisplay.textContent = `${(minVal + 0.5).toFixed(1)}s`;
            }

            // Update slider appearance
            const minPercent = ((minVal - 1) / 9) * 100;
            const maxPercent = ((maxVal - 2) / 13) * 100;
            
            minInterval.style.background = `linear-gradient(to right, 
                var(--accent-color) 0%, 
                var(--accent-color) ${minPercent}%, 
                var(--bg-lighter) ${minPercent}%, 
                var(--bg-lighter) 100%)`;
            
            maxInterval.style.background = `linear-gradient(to right, 
                var(--accent-color) 0%, 
                var(--accent-color) ${maxPercent}%, 
                var(--bg-lighter) ${maxPercent}%, 
                var(--bg-lighter) 100%)`;
        }

        minInterval.addEventListener('input', updateIntervalDisplays);
        maxInterval.addEventListener('input', updateIntervalDisplays);
        
        // Initialize slider appearance
        updateIntervalDisplays();

        // Save changes with fixed scope
        const saveBtn = settingsDialog.querySelector('.save-btn');
        saveBtn.addEventListener('click', function() {
            const minIntervalVal = parseFloat(minInterval.value) * 1000;
            const maxIntervalVal = parseFloat(maxInterval.value) * 1000;

            // Save intervals
            chatIntervals.min = minIntervalVal;
            chatIntervals.max = maxIntervalVal;
            
            // Save token overrides
            const newTokenOverrides = {
                enabled: tokenOverrideToggle.checked,
                limits: {}
            };

            if (tokenOverrideToggle.checked) {
                settingsDialog.querySelectorAll('.contact-token-input').forEach(input => {
                    const contactId = input.dataset.contactId;
                    newTokenOverrides.limits[contactId] = parseInt(input.value, 10);
                });
            }

            // Save both settings
            localStorage.setItem('groupTokenOverrides', JSON.stringify(newTokenOverrides));
            localStorage.setItem('chatSettings', JSON.stringify({
                minInterval: minIntervalVal,
                maxInterval: maxIntervalVal
            }));

            // Show success notification
            const notification = document.createElement('div');
            notification.classList.add('notification');
            notification.textContent = 'Settings saved successfully';
            document.body.appendChild(notification);
            
            setTimeout(() => {
                notification.remove();
            }, 3000);

            settingsDialog.remove();
        });

        // Add cancel button handler
        const cancelBtn = settingsDialog.querySelector('.cancel-btn');
        cancelBtn.addEventListener('click', () => {
            settingsDialog.remove();
        });

        // ...rest of the existing dialog code...
    }

    // Update the clearChat function
    async function clearChat() {
        if (!currentGroup || document.getElementById('clearChatBtn').classList.contains('disabled')) return;

        const confirmClear = confirm('Are you sure you want to clear this chat? This cannot be undone.');
        if (confirmClear) {
            // Clear chat history completely
            groupMessages[currentGroup.id] = [];
            await conversationStorage.save(currentGroup.id, []);
            chatWindow.innerHTML = '';

            // Add welcome message with members list
            const memberNames = currentGroup.members
                .map(id => aiContacts.find(c => c.id === id)?.name)
                .filter(Boolean)
                .join(', ');

            const welcomeDiv = document.createElement('div');
            welcomeDiv.classList.add('welcome-message');
            welcomeDiv.innerHTML = `
                <p>Connected to ${memberNames}</p>
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

    function updateAutoChatButtonState() {
        const autoChatBtn = document.getElementById('autoChatBtn');
        if (!autoChatBtn) return;

        if (!currentGroup) {
            autoChatBtn.classList.add('disabled');
            autoChatBtn.setAttribute('title', 'Select a group to enable auto-chat');
            if (isAutoChatEnabled) {
                toggleAutoChat(); // Disable auto-chat if it was running
            }
        } else {
            autoChatBtn.classList.remove('disabled');
            autoChatBtn.setAttribute('title', 'Toggle Auto Chat');
        }
    }

    // Update the toggleAutoChat function
    function toggleAutoChat() {
        if (!currentGroup) return;
        
        const autoChatBtn = document.getElementById('autoChatBtn');
        
        // Clear all existing timers
        ConversationController.clearAllTimers();
        clearTimeout(autoChatInterval);
        autoChatInterval = null;
        
        // Toggle state
        isAutoChatEnabled = !isAutoChatEnabled;
        
        if (isAutoChatEnabled) {
            ConversationController.initialize();
            autoChatBtn.classList.add('active');
            
            const ais = currentGroup.members
                .map(id => aiContacts.find(c => c.id === id))
                .filter(Boolean)
                .map(ai => ai.name)
                .join(', ');
                
            addGroupMessage(
                `Auto-chat enabled. Active participants: ${ais}. They will converse based on their unique personalities.`,
                "System",
                false
            ).then(() => {
                if (isAutoChatEnabled) {
                    initiateAutoChat();
                }
            });
        } else {
            autoChatBtn.classList.remove('active');
            addGroupMessage("Auto-chat disabled.", "System", false);
        }
    }

    // Update the setupEventListeners function
    function setupEventListeners() {
        // Remove previous event listeners if they exist
        const autoChatBtn = document.getElementById('autoChatBtn');
        if (autoChatBtn) {
            const newBtn = autoChatBtn.cloneNode(true);
            autoChatBtn.parentNode.replaceChild(newBtn, autoChatBtn);
            
            newBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!newBtn.classList.contains('disabled')) {
                    toggleAutoChat();
                }
            });
        }
    }

    // Event Listeners
    addGroupBtn.addEventListener('click', () => {
        createGroupDialog.style.display = 'flex';
        renderMembersList();
    });

    cancelBtn.addEventListener('click', () => {
        createGroupDialog.style.display = 'none';
    });

    createGroupForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const groupName = document.getElementById('groupName').value;
        const groupDescription = document.getElementById('groupDescription').value;
        const selectedMembers = Array.from(membersList.querySelectorAll('input:checked')).map(input => input.value);

        if (!groupName || selectedMembers.length === 0) {
            alert('Please enter a group name and select at least one member');
            return;
        }

        const newGroup = {
            id: Date.now().toString(),
            name: groupName,
            description: groupDescription,
            members: selectedMembers,
            createdAt: new Date().toISOString()
        };

        groups.push(newGroup);
        saveGroups();
        renderGroups();
        createGroupDialog.style.display = 'none';
        createGroupForm.reset();
        startGroupChat(newGroup);
    });

    sendBtn.addEventListener('click', async () => {
        const message = messageInput.value.trim();
        if (message && currentGroup) {
            messageInput.value = ''; // Clear input immediately
            await handleGroupMessage(message, currentGroup);
        }
    });

    messageInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
            const message = messageInput.value.trim();
            if (message && currentGroup) {
                messageInput.value = ''; // Clear input immediately
                await handleGroupMessage(message, currentGroup);
            }
        }
    });

    // Add event listener for auto-chat button
    document.getElementById('autoChatBtn').addEventListener('click', toggleAutoChat);

    // Add event listeners
    document.getElementById('settingsBtn').addEventListener('click', showSettingsDialog);
    document.getElementById('clearChatBtn').addEventListener('click', clearChat);

    // Fix create group dialog cancel button
    document.querySelectorAll('#cancelBtn').forEach(btn => {
        btn.addEventListener('click', () => {
            createGroupDialog.style.display = 'none';
            createGroupForm.reset();
        });
    });

    // Add refresh contacts button listener
    document.getElementById('refreshContacts').addEventListener('click', refreshContacts);
    
    // Update member count when checkboxes change
    membersList.addEventListener('change', event => {
        if (event.target.type === 'checkbox') {
            updateMemberCount();
        }
    });

    // Initial render
    renderGroups();
    updateAutoChatButtonState();

    // Initialize clear button state
    document.getElementById('clearChatBtn').classList.add('disabled');

    // Call the new setup function
    setupEventListeners();
});

// Update the loadGroupMessages function
async function loadGroupMessages() {
    try {
        // Try to load from file first
        const response = await fetch('../data/group_messages.json');
        let data;
        
        if (response.ok) {
            data = await response.json();
        } else {
            // If file load fails, try localStorage
            const localData = localStorage.getItem('groupMessages');
            data = localData ? JSON.parse(localData) : { messages: {}, lastUpdate: '' };
        }

        // Validate and clean the loaded messages
        const cleanedMessages = {};
        for (const groupId in data.messages) {
            // Remove duplicates by using a Map with message ID as key
            const messagesMap = new Map();
            data.messages[groupId].forEach(msg => {
                if (!msg.id) {
                    msg.id = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                }
                messagesMap.set(msg.id, msg);
            });
            
            // Convert back to array and sort by timestamp
            cleanedMessages[groupId] = Array.from(messagesMap.values())
                .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        }

        return cleanedMessages;
    } catch (error) {
        console.error('Error loading messages:', error);
        return {};
    }
}

// Keep only this part to maintain theme consistency across pages
if (localStorage.getItem('theme') === 'light') {
    document.body.classList.add('light-theme');
}

// Add these new objects at the top level
const ConversationState = {
    topics: new Set(),
    emotionalState: new Map(),
    recentContext: [],
    conversationStage: 'idle', // idle, active, winding-down
    lastTopicChange: Date.now(),
    flowControl: {
        turnsInTopic: 0,
        consecutiveShortResponses: 0,
        participationBalance: new Map()
    }
};

const PersonalityTraits = {
    calculateResponseTiming(contact, messageLength, context) {
        // Base timing calculations
        const baseTime = Math.max(
            1000, // Minimum 1 second
            Math.min(messageLength * 25, 4000) // Max 4 seconds for reading
        );

        // Personality adjustments
        const personality = contact.promptTemplate.toLowerCase();
        let multiplier = 1.0;

        if (personality.includes('thoughtful') || personality.includes('analytical')) {
            multiplier *= 1.3;
        } else if (personality.includes('quick') || personality.includes('efficient')) {
            multiplier *= 0.8;
        }

        // Context adjustments
        if (context.isQuestion) multiplier *= 0.9;
        if (context.isComplex) multiplier *= 1.4;
        if (context.requiresResearch) multiplier *= 1.6;

        // Add natural variance (±20%)
        const variance = 0.8 + (Math.random() * 0.4);

        return Math.floor(baseTime * multiplier * variance);
    },

    shouldRespond(contact, context) {
        const personality = contact.promptTemplate.toLowerCase();
        const baseChance = 0.7;
        let modifiedChance = baseChance;

        // Personality-based adjustments
        if (personality.includes('talkative')) modifiedChance += 0.2;
        if (personality.includes('reserved')) modifiedChance -= 0.2;

        // Context-based adjustments
        if (context.isDirectQuestion) modifiedChance += 0.4;
        if (context.mentionsExpertise && personality.includes(context.topic)) modifiedChance += 0.3;
        if (ConversationState.flowControl.participationBalance.get(contact.id) > 3) modifiedChance -= 0.3;

        return Math.random() < modifiedChance;
    }
};

// Replace the existing initiateAutoChat function
async function initiateAutoChat() {
    if (!currentGroup || !isAutoChatEnabled) return;

    try {
        // Update conversation stage
        if (ConversationState.conversationStage === 'idle') {
            ConversationState.conversationStage = 'active';
            await startNewConversationTopic();
        }

        const initiator = selectInitiatorSmart();
        if (!initiator) return;

        const recentMessages = await getEnhancedContext();
        const topicContext = Array.from(ConversationState.topics).slice(-2);
        
        const conversationContext = {
            stage: ConversationState.conversationStage,
            currentTopic: topicContext[topicContext.length - 1],
            emotionalState: ConversationState.emotionalState.get(initiator.id) || 'neutral',
            recentSpeakers: recentMessages.slice(-3).map(m => m.author)
        };

        const prompt = generateSmartPrompt(initiator, recentMessages, conversationContext);
        const response = await generateSmartResponse(initiator, prompt);

        if (response && isAutoChatEnabled) {
            await processAndAddResponse(response, initiator);
            await manageConversationFlow(initiator, response);
        }

    } catch (error) {
        console.error('Error in smart auto-chat:', error);
    }
}

// Add these new helper functions
async function startNewConversationTopic() {
    const topics = [
        { topic: "AI Ethics", weight: 1 },
        { topic: "Future Technology", weight: 1 },
        { topic: "Human-AI Collaboration", weight: 1 },
        // Add more weighted topics
    ];

    // Select topic based on participant expertise and previous discussions
    const selectedTopic = selectWeightedTopic(topics);
    ConversationState.topics.add(selectedTopic);
    ConversationState.lastTopicChange = Date.now();
    
    // Announce topic change subtly
    await addGroupMessage(
        `I've been thinking about ${selectedTopic}. What are your thoughts on this?`,
        selectInitiatorSmart().name,
        false
    );
}

function selectInitiatorSmart() {
    const members = currentGroup.members
        .map(id => aiContacts.find(c => c.id === id))
        .filter(Boolean);

    return members.reduce((best, current) => {
        let score = 0;
        
        // Calculate participation balance
        const participationCount = ConversationState.flowControl.participationBalance.get(current.id) || 0;
        score -= participationCount * 0.5;

        // Topic expertise
        const currentTopic = Array.from(ConversationState.topics).pop();
        if (current.promptTemplate.toLowerCase().includes(currentTopic?.toLowerCase())) {
            score += 2;
        }

        // Conversation flow
        if (ConversationState.recentContext.slice(-2).every(msg => msg.author !== current.name)) {
            score += 1;
        }

        return (score > (best?.score || -Infinity)) ? { ...current, score } : best;
    }, null);
}

async function generateSmartResponse(ai, prompt) {
    try {
        const response = await sendToAI(prompt, ai);
        
        // Clean the response text immediately after receiving it
        const cleanedResponse = TextNormalizer.cleanResponse(
            TextNormalizer.normalizeQuotes(response)
        );
        
        // Analyze response quality
        const quality = analyzeResponseQuality(cleanedResponse);
        
        if (quality.needsImprovement) {
            const enhancedPrompt = `Please improve this response to be more natural and engaging while maintaining your personality: "${cleanedResponse}"`;
            const improvedResponse = await sendToAI(enhancedPrompt, ai);
            return TextNormalizer.cleanResponse(TextNormalizer.normalizeQuotes(improvedResponse));
        }

        return cleanedResponse;
    } catch (error) {
        console.error('Error generating smart response:', error);
        return null;
    }
}

function analyzeResponseQuality(response) {
    return {
        needsImprovement: response.length < 20 || 
                         response.includes('I don\'t know') ||
                         /^(yes|no|maybe|indeed)\.?$/i.test(response.trim()),
        isQuestion: response.includes('?'),
        length: response.length,
        sentiment: analyzeSentiment(response)
    };
}

// Add more helper functions...

// Add these conversation timing constants near the top
const ConversationTiming = {
    BASE_TYPING_SPEED: 25, // Slower typing speed (characters per second)
    THINKING_TIME: {
        MIN: 1000,    // Minimum 1 second
        MAX: 3000     // Maximum 3 seconds
    },
    NATURAL_PAUSE: {
        SHORT: 1500,  // Brief pause between related messages
        MEDIUM: 2500, // Natural pause in conversation
        TOPIC: 4000   // Pause when changing topics
    },
    TYPING_VARIANCE: 0.3 // 30% random variance in typing speed
};

// Add this new timing manager
const TimingManager = {
    calculateResponseTime(message, personality) {
        // Base time to "type" the message
        const typeTime = (message.length / ConversationTiming.BASE_TYPING_SPEED) * 1000;
        
        // Add thinking time based on message complexity
        const complexity = this.analyzeComplexity(message);
        const thinkTime = this.calculateThinkingTime(complexity, personality);
        
        return typeTime + thinkTime;
    },

    analyzeComplexity(message) {
        let complexity = 1;
        
        // Increase complexity for longer messages
        complexity += message.length / 100;
        
        // Increase for technical terms
        if (/\b(algorithm|programming|technical|analysis)\b/i.test(message)) {
            complexity *= 1.2;
        }
        
        // Increase for questions or deep topics
        if (message.includes('?') || /\b(philosophy|ethics|future|implications)\b/i.test(message)) {
            complexity *= 1.3;
        }

        return Math.min(complexity, 2.5); // Cap at 2.5x
    },

    calculateThinkingTime(complexity, personality) {
        let baseThink = Math.random() * 
            (ConversationTiming.THINKING_TIME.MAX - ConversationTiming.THINKING_TIME.MIN) + 
            ConversationTiming.THINKING_TIME.MIN;
        
        // Adjust for personality
        if (personality.includes('quick') || personality.includes('efficient')) {
            baseThink *= 0.7;
        } else if (personality.includes('thoughtful') || personality.includes('analytical')) {
            baseThink *= 1.3;
        }
        
        return baseThink * complexity;
    },

    getNextResponseDelay(context) {
        const { lastResponseTime, messageCount, isNewTopic } = context;
        
        if (isNewTopic) {
            return ConversationTiming.NATURAL_PAUSE.TOPIC;
        }
        
        // Shorter delays during active conversation
        if (messageCount > 3 && Date.now() - lastResponseTime < 10000) {
            return ConversationTiming.NATURAL_PAUSE.SHORT;
        }
        
        return ConversationTiming.NATURAL_PAUSE.MEDIUM;
    },

    calculateNaturalDelay(ai, context) {
        const baseDelay = this.getBaseDelay(ai);
        const contextMultiplier = this.getContextMultiplier(context);
        const personalityMultiplier = this.getPersonalityMultiplier(ai);
        
        // Calculate final delay with natural variance
        const finalDelay = baseDelay * contextMultiplier * personalityMultiplier;
        return this.addNaturalVariance(finalDelay);
    },

    getBaseDelay(ai) {
        return Math.random() * 
            (ConversationTiming.THINKING_TIME.MAX - ConversationTiming.THINKING_TIME.MIN) + 
            ConversationTiming.THINKING_TIME.MIN;
    },

    getContextMultiplier(context) {
        let multiplier = 1.0;
        
        if (context.isQuestion) multiplier *= 0.85;
        if (context.isDirectMention) multiplier *= 0.8;
        if (context.isComplexTopic) multiplier *= 1.2;
        
        return multiplier;
    },

    getPersonalityMultiplier(ai) {
        const personality = ai.promptTemplate.toLowerCase();
        let multiplier = 1.0;

        if (personality.includes('quick') || personality.includes('enthusiastic')) {
            multiplier *= 0.9;
        } else if (personality.includes('thoughtful') || personality.includes('careful')) {
            multiplier *= 1.3;
        }

        return multiplier;
    },

    addNaturalVariance(delay) {
        const variance = 1 + (Math.random() * ConversationTiming.TYPING_VARIANCE * 2 - ConversationTiming.TYPING_VARIANCE);
        return Math.floor(delay * variance);
    },

    calculateTypingDuration(message, member) {
        // Calculate base typing time based on message length
        const baseTypingSpeed = ConversationTiming.BASE_TYPING_SPEED * 
            (member.promptTemplate.toLowerCase().includes('quick') ? 1.2 : 1);
        
        const characterDelay = 1000 / baseTypingSpeed; // ms per character
        const baseTime = message.length * characterDelay;
        
        // Add natural variance to typing speed
        return this.addNaturalVariance(baseTime);
    }
};

// Replace the existing processAIResponses function
async function processAIResponses(message, initiator) {
    if (!isAutoChatEnabled || !currentGroup) return;

    try {
        const messageIndicators = analyzeMessage(message);
        const otherMembers = currentGroup.members
            .filter(id => id !== initiator.id)
            .map(id => aiContacts.find(c => c.id === id))
            .filter(Boolean);

        const recentMessages = (groupMessages[currentGroup.id] || [])
            .slice(-MAX_CONTEXT_MESSAGES)
            .map(msg => `${msg.author}: ${msg.text}`);

        recentMessages.push(`${initiator.name}: ${message}`);

        // Process each member's response with proper delays
        for (const member of otherMembers) {
            let responseChance = chatIntervals.responseChance;
            
            // Calculate response chance
            if (messageIndicators.isQuestion) responseChance += 0.2;
            if (messageIndicators.hasTechnicalTerms && member.promptTemplate.toLowerCase().includes('technical')) responseChance += 0.3;
            if (messageIndicators.isGreeting && member.promptTemplate.toLowerCase().includes('friendly')) responseChance += 0.2;
            if (message.toLowerCase().includes(member.name.toLowerCase())) responseChance += 0.4;

            if (Math.random() < responseChance) {
                // Ensure minimum delay between responses
                const minDelay = Math.max(chatIntervals.min, 2000); // At least 2 seconds
                const maxDelay = Math.max(chatIntervals.max, minDelay + 2000); // At least 2 seconds more than min
                const delay = Math.random() * (maxDelay - minDelay) + minDelay;

                // Wait for the calculated delay
                await new Promise(resolve => setTimeout(resolve, delay));
                
                if (!isAutoChatEnabled) return; // Check if still enabled after delay

                const prompt = `You are participating in a group chat conversation.

                    Recent messages:
                    ${recentMessages.join('\n')}

                    You are ${member.name}. ${member.promptTemplate}

                    Instructions:
                    1. Respond naturally to the ongoing conversation
                    2. Do not prefix your response with your name
                    3. Stay in character as ${member.name}
                    4. If you have nothing relevant to add, respond with "NO_RESPONSE"
                    5. Engage with what others have said

                    Your response:`;

                const thinkingMsg = await addThinkingMessage(member.name);
                const response = await sendToAI(prompt, member, recentMessages);
                
                if (thinkingMsg?.parentNode) {
                    thinkingMsg.remove();
                }

                if (response && !response.includes('NO_RESPONSE')) {
                    const cleanResponse = response.replace(/^([^:]+: )|^["']|["']$/g, '').trim();
                    await addGroupMessage(cleanResponse, member.name, false);
                }
            }
        }

        // Schedule next conversation round with proper delay
        if (isAutoChatEnabled) {
            clearTimeout(autoChatInterval);
            const baseDelay = chatIntervals.max * 2; // Double the max interval for conversation rounds
            const participantFactor = otherMembers.length * 0.5; // Add more delay based on participant count
            const nextDelay = baseDelay + (baseDelay * participantFactor) + Math.random() * 3000;
            autoChatInterval = setTimeout(initiateAutoChat, nextDelay);
        }
    } catch (error) {
        console.error('Error in processAIResponses:', error);
    }
}

// Add this new timing controller near the top
const ConversationController = {
    activeTimers: new Map(),
    responseQueue: [],
    lastActivity: Date.now(),

    initialize() {
        this.activeTimers.clear();
        this.responseQueue = [];
        this.lastActivity = Date.now();
    },

    clearAllTimers() {
        this.activeTimers.forEach(timer => clearTimeout(timer));
        this.activeTimers.clear();
        this.responseQueue = [];
    },

    getEffectiveDelay(context) {
        const { settings, personality, messageType } = context;
        let baseDelay = Math.random() * (settings.max - settings.min) + settings.min;

        // Adjust for conversation activity
        const timeSinceLastActivity = Date.now() - this.lastActivity;
        if (timeSinceLastActivity < 5000) { // Active conversation
            baseDelay *= 0.7; // Faster responses during active chat
        }

        // Personality adjustments
        if (personality.includes('quick')) baseDelay *= 0.8;
        if (personality.includes('thoughtful')) baseDelay *= 1.2;

        // Message type adjustments
        if (messageType.isQuestion) baseDelay *= 0.8;
        if (messageType.isDirectMention) baseDelay *= 0.7;

        return Math.max(settings.min * 0.5, Math.min(baseDelay, settings.max));
    }
};

// Replace the existing processAIResponses function
async function processAIResponses(message, initiator) {
    if (!isAutoChatEnabled || !currentGroup) return;

    try {
        const messageIndicators = analyzeMessage(message);
        const eligibleResponders = currentGroup.members
            .filter(id => id !== initiator.id)
            .map(id => aiContacts.find(c => c.id === id))
            .filter(Boolean);

        // Process responses with natural timing
        const processingPromises = eligibleResponders.map(async (member) => {
            if (!PersonalityTraits.shouldRespond(member, {
                ...messageIndicators,
                isDirectQuestion: message.toLowerCase().includes(member.name.toLowerCase())
            })) {
                return;
            }

            const delay = ConversationController.getEffectiveDelay({
                settings: chatIntervals,
                personality: member.promptTemplate.toLowerCase(),
                messageType: messageIndicators
            });

            // Create and track the response timer
            const responsePromise = new Promise(async (resolve) => {
                const timerId = setTimeout(async () => {
                    try {
                        const thinkingMsg = await addThinkingMessage(member.name);
                        const response = await generateSmartResponse(member, createContextualPrompt(message, member));
                        
                        if (thinkingMsg?.parentNode) {
                            thinkingMsg.remove();
                        }

                        if (response && !response.includes('NO_RESPONSE')) {
                            const cleanResponse = response.replace(/^([^:]+: )|^["']|["']$/g, '').trim();
                            await addGroupMessage(cleanResponse, member.name, false);
                            ConversationController.lastActivity = Date.now();
                        }
                        resolve();
                    } catch (error) {
                        console.error(`Response error for ${member.name}:`, error);
                        resolve();
                    }
                }, delay);

                ConversationController.activeTimers.set(member.id, timerId);
            });

            return responsePromise;
        });

        // Wait for all responses to complete
        await Promise.all(processingPromises.filter(Boolean));

        // Schedule next conversation stimulus if needed
        if (isAutoChatEnabled) {
            const nextDelay = ConversationController.getEffectiveDelay({
                settings: chatIntervals,
                personality: 'neutral',
                messageType: { isQuestion: false, isDirectMention: false }
            });

            clearTimeout(autoChatInterval);
            autoChatInterval = setTimeout(initiateAutoChat, nextDelay);
        }

    } catch (error) {
        console.error('Error in processAIResponses:', error);
    }
}

// Update the toggleAutoChat function
function toggleAutoChat() {
    if (!currentGroup) return;
    
    const autoChatBtn = document.getElementById('autoChatBtn');
    
    // Clear all existing timers
    ConversationController.clearAllTimers();
    clearTimeout(autoChatInterval);
    autoChatInterval = null;
    
    // Toggle state
    isAutoChatEnabled = !isAutoChatEnabled;
    
    if (isAutoChatEnabled) {
        ConversationController.initialize();
        autoChatBtn.classList.add('active');
        
        const ais = currentGroup.members
            .map(id => aiContacts.find(c => c.id === id))
            .filter(Boolean)
            .map(ai => ai.name)
            .join(', ');
            
        addGroupMessage(
            `Auto-chat enabled. Active participants: ${ais}. They will converse based on their unique personalities.`,
            "System",
            false
        ).then(() => {
            if (isAutoChatEnabled) {
                initiateAutoChat();
            }
        });
    } else {
        autoChatBtn.classList.remove('active');
        addGroupMessage("Auto-chat disabled.", "System", false);
    }
}

// Update the showSettingsDialog function's save handler
function updateSettingsHandler(settings) {
    chatIntervals.min = Math.max(500, settings.minInterval); // Minimum 500ms
    chatIntervals.max = Math.max(settings.maxInterval, chatIntervals.min + 500); // Always at least 500ms more than min
    
    // Immediately apply new timing settings
    if (isAutoChatEnabled) {
        ConversationController.clearAllTimers();
        clearTimeout(autoChatInterval);
        initiateAutoChat();
    }
}

// Add this helper to be used in the main conversation flow
function shouldStartNewThread() {
    const timeSinceLastActivity = Date.now() - ConversationController.lastActivity;
    const isConversationStale = timeSinceLastActivity > ConversationDynamics.ACTIVITY_TIMEOUT;
    const noActiveResponders = ConversationController.activeTimers.size === 0;
    
    return isConversationStale && noActiveResponders;
}

// Add these improved timing and context management systems
const ConversationDynamics = {
    // Timing controls
    TYPING_SPEED: {
        FAST: 35,    // chars per second
        NORMAL: 25,
        THOUGHTFUL: 20
    },
    RESPONSE_DELAYS: {
        QUICK: 800,    // Quick reactions
        NATURAL: 1200, // Natural pauses
        THOUGHTFUL: 2000 // Thoughtful responses
    },
    CONTEXT_WINDOW: 10, // Number of messages to maintain for context
    // Conversation state tracking
    activeThreads: new Set(),
    lastResponse: new Map(),
    conversationHeat: 0, // Tracks conversation intensity
};

// Add sophisticated context management
const ContextManager = {
    shortTermMemory: new Map(), // Recent interactions
    conversationThreads: new Map(), // Active discussion threads
    topicHistory: [], // Track topic changes
    
    updateContext(message, author) {
        const context = {
            timestamp: Date.now(),
            content: message,
            author: author,
            topic: this.getCurrentTopic(message),
            sentiment: this.analyzeSentiment(message)
        };

        // Update short-term memory
        this.shortTermMemory.set(author, {
            lastMessage: context,
            messageCount: (this.shortTermMemory.get(author)?.messageCount || 0) + 1
        });

        // Track conversation threads
        const thread = this.identifyThread(message);
        if (thread) {
            if (!this.conversationThreads.has(thread)) {
                this.conversationThreads.set(thread, []);
            }
            this.conversationThreads.get(thread).push(context);
        }

        return context;
    },

    getCurrentTopic(message) {
        // Enhanced topic detection
        const topics = {
            technical: /\b(code|programming|algorithm|development|software)\b/i,
            conceptual: /\b(concept|theory|approach|methodology)\b/i,
            opinion: /\b(think|believe|feel|opinion|perspective)\b/i,
            question: /\b(what|how|why|when|where|who|which)\b.*\?/i
        };

        for (const [topic, pattern] of Object.entries(topics)) {
            if (pattern.test(message)) return topic;
        }
        return 'general';
    },

    analyzeSentiment(message) {
        // Improved sentiment analysis
        const indicators = {
            positive: /\b(great|good|excellent|amazing|love|happy|agree|yes|thanks)\b/i,
            negative: /\b(bad|wrong|disagree|no|cannot|shouldn't|won't)\b/i,
            neutral: /\b(think|maybe|perhaps|possibly|understand)\b/i,
            questioning: /\b(what|how|why|when|where|who|which)\b.*\?/i
        };

        let sentiment = { type: 'neutral', strength: 0.5 };
        
        for (const [type, pattern] of Object.entries(indicators)) {
            if (pattern.test(message)) {
                sentiment.type = type;
                sentiment.strength = (message.match(pattern) || []).length * 0.2 + 0.5;
                break;
            }
        }

        return sentiment;
    },

    identifyThread(message) {
        // Thread detection based on content similarity and timing
        for (const [thread, messages] of this.conversationThreads) {
            const lastMessage = messages[messages.length - 1];
            if (this.areRelated(message, lastMessage.content)) {
                return thread;
            }
        }
        return `thread_${Date.now()}`;
    },

    areRelated(message1, message2) {
        // Check content similarity and context
        const words1 = new Set(message1.toLowerCase().split(/\W+/));
        const words2 = new Set(message2.toLowerCase().split(/\W+/));
        const intersection = new Set([...words1].filter(x => words2.has(x)));
        return intersection.size >= 2;
    }
};

// Add improved response timing management
const ResponseManager = {
    queue: new Map(),
    activeResponses: new Set(),

    async scheduleResponse(member, message, context) {
        const timing = this.calculateTiming(member, message, context);
        const delay = this.getResponseDelay(member, context);

        return new Promise(resolve => {
            setTimeout(async () => {
                if (!isAutoChatEnabled) {
                    resolve();
                    return;
                }

                await this.executeResponse(member, message, timing);
                resolve();
            }, delay);
        });
    },

    calculateTiming(member, message, context) {
        const personality = member.promptTemplate.toLowerCase();
        const baseSpeed = this.getBaseSpeed(personality);
        const contextMultiplier = this.getContextMultiplier(context);
        
        return {
            typingSpeed: baseSpeed * contextMultiplier,
            thinkingTime: this.getThinkingTime(personality, context),
            naturalPause: this.getNaturalPause(context)
        };
    },

    getBaseSpeed(personality) {
        if (personality.includes('quick') || personality.includes('enthusiastic')) {
            return ConversationDynamics.TYPING_SPEED.FAST;
        } else if (personality.includes('thoughtful') || personality.includes('analytical')) {
            return ConversationDynamics.TYPING_SPEED.THOUGHTFUL;
        }
        return ConversationDynamics.TYPING_SPEED.NORMAL;
    },

    getContextMultiplier(context) {
        let multiplier = 1.0;
        
        if (context.isQuestion) multiplier *= 0.9;
        if (context.isEmergent) multiplier *= 0.8;
        if (context.requiresThought) multiplier *= 1.2;
        
        return multiplier;
    },

    getThinkingTime(personality, context) {
        let base = ConversationDynamics.RESPONSE_DELAYS.NATURAL;
        
        if (personality.includes('quick')) {
            base = ConversationDynamics.RESPONSE_DELAYS.QUICK;
        } else if (personality.includes('thoughtful')) {
            base = ConversationDynamics.RESPONSE_DELAYS.THOUGHTFUL;
        }

        // Adjust for context
        if (context.isQuestion) base *= 0.8;
        if (context.isComplex) base *= 1.3;
        
        // Add natural variance
        return base * (0.8 + Math.random() * 0.4);
    },

    getNaturalPause(context) {
        const baseDelay = ConversationDynamics.conversationHeat > 0.7 
            ? ConversationDynamics.RESPONSE_DELAYS.QUICK
            : ConversationDynamics.RESPONSE_DELAYS.NATURAL;

        return baseDelay * (0.8 + Math.random() * 0.4);
    },

    getResponseDelay(member, context) {
        const lastResponse = ConversationDynamics.lastResponse.get(member.id) || 0;
        const timeSinceLastResponse = Date.now() - lastResponse;
        
        // Ensure minimum gap between responses
        if (timeSinceLastResponse < ConversationDynamics.RESPONSE_DELAYS.QUICK) {
            return ConversationDynamics.RESPONSE_DELAYS.QUICK;
        }

        return this.getNaturalPause(context);
    },

    async executeResponse(member, message, timing) {
        const thinkingMsg = await addThinkingMessage(member.name);
        
        // Simulate thinking time
        await new Promise(resolve => setTimeout(resolve, timing.thinkingTime));
        
        const response = await generateSmartResponse(member, message);
        
        if (thinkingMsg?.parentNode) {
            thinkingMsg.remove();
        }

        if (response && !response.includes('NO_RESPONSE')) {
            // Clean up the response text
            const cleanResponse = TextNormalizer.cleanResponse(
                TextNormalizer.normalizeQuotes(
                    response.replace(/^([^:]+: )|^["']|["']$/g, '').trim()
                )
            );
            
            // Simulate natural typing
            const typingTime = (cleanResponse.length / timing.typingSpeed) * 1000;
            await new Promise(resolve => setTimeout(resolve, typingTime));

            await addGroupMessage(cleanResponse, member.name, false);
            
            // Update conversation state
            ConversationDynamics.lastResponse.set(member.id, Date.now());
            ConversationDynamics.conversationHeat = Math.min(
                1, 
                ConversationDynamics.conversationHeat + 0.2
            );

            // Update context
            ContextManager.updateContext(cleanResponse, member.name);
        }
    }
};

// Update the processAIResponses function to use the new systems
async function processAIResponses(message, initiator) {
    if (!isAutoChatEnabled || !currentGroup) return;

    try {
        // Update conversation context
        const context = ContextManager.updateContext(message, initiator.name);
        const messageIndicators = analyzeMessage(message);

        const eligibleResponders = currentGroup.members
            .filter(id => id !== initiator.id)
            .map(id => aiContacts.find(c => c.id === id))
            .filter(Boolean);

        // Process responses with smart timing
        const responsePromises = eligibleResponders
            .filter(member => PersonalityTraits.shouldRespond(member, {
                ...messageIndicators,
                context: context
            }))
            .map(member => ResponseManager.scheduleResponse(member, message, {
                ...messageIndicators,
                context: context
            }));

        // Wait for all responses to complete
        await Promise.all(responsePromises);

        // Cool down conversation heat
        ConversationDynamics.conversationHeat = Math.max(
            0,
            ConversationDynamics.conversationHeat - 0.1
        );

        // Schedule next conversation stimulus if needed
        if (isAutoChatEnabled) {
            clearTimeout(autoChatInterval);
            const nextDelay = calculateNextConversationDelay(responsePromises.length);
            autoChatInterval = setTimeout(() => {
                if (shouldContinueConversation()) {
                    initiateAutoChat();
                }
            }, nextDelay);
        }
    } catch (error) {
        console.error('Error in processAIResponses:', error);
    }
}

// Add helper function to determine if conversation should continue
function shouldContinueConversation() {
    const timeSinceLastResponse = Date.now() - Math.max(...ConversationDynamics.lastResponse.values());
    const isConversationActive = timeSinceLastResponse < ConversationDynamics.RESPONSE_DELAYS.THOUGHTFUL * 2;
    return isConversationActive || ConversationDynamics.conversationHeat > 0.3;
}

// Add this new text normalization helper
const TextNormalizer = {
    cleanResponse(text) {
        return text
            // Fix spaces after punctuation
            .replace(/([.,!?;:])\s*(\S)/g, '$1 $2')
            // Fix spaces between words
            .replace(/\s+/g, ' ')
            // Fix spaces around em dashes
            .replace(/\s*—\s*/g, ' — ')
            // Fix spaces around apostrophes
            .replace(/(\w)'(\w)/g, "$1'$2")
            // Fix spaces around emojis
            .replace(/(\S)([\u{1F300}-\u{1F9FF}])/gu, '$1 $2')
            .replace(/([\u{1F300}-\u{1F9FF}])(\S)/gu, '$1 $2')
            // Normalize whitespace
            .trim();
    },

    normalizeQuotes(text) {
        return text
            .replace(/['′']/g, "'")
            .replace(/["″"]/g, '"')
            .replace(/\s*"\s*/g, ' "')
            .replace(/\s*'\s*/g, " '");
    }
};

// ...existing code...

/* ...existing code... */
