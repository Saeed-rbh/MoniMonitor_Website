const states = new Map();

function reportSubsystem(name, patch = {}) {
    const previous = states.get(name) || {};
    states.set(name, {
        ...previous,
        ...patch,
        updatedAt: new Date().toISOString(),
    });
}

function getSubsystemHealth(name) {
    return states.get(name) || null;
}

function getAllSubsystemHealth() {
    return Object.fromEntries(states.entries());
}

module.exports = { reportSubsystem, getSubsystemHealth, getAllSubsystemHealth };
