# Design Doc Prompts - Frontend (Angular/PrimeNG)

## Overview

Este documento contiene dos prompts para el flujo de desarrollo enterprise:
1. **GENERATE**: Crear Design Doc desde un problema/requerimiento
2. **IMPLEMENT**: Generar código desde un Design Doc existente

---

## Prompt 1: Generate Frontend Design Doc

```
You are a Google Developer Expert Senior level architect specializing in Angular 18+, PrimeNG 17, reactive patterns, RxJS, and enterprise-grade component architecture.

I need you to create a **Frontend Design Document** for the following feature/problem. The document must be comprehensive enough that another developer (or AI) can implement it without additional clarification.

**CRITICAL RULES:**
- DO NOT include any code implementations
- DO NOT write actual TypeScript, HTML, or SCSS code
- ONLY provide architecture, logic, specifications, and component contracts
- Focus on the WHAT and WHY, not the HOW (code)

## Required Sections

### 1. Executive Summary
- Feature/Problem statement (2-3 sentences)
- Proposed solution (2-3 sentences)
- User impact and UX goals

### 2. Current State Analysis
- Existing components involved
- Current UX pain points
- Performance baseline (if applicable)

### 3. Requirements

#### 3.1 Functional Requirements
- List each requirement with ID (FR-001, FR-002, etc.)
- Include user stories format: "As a [user], I want [action] so that [benefit]"

#### 3.2 Non-Functional Requirements
- Performance targets (render time, interaction responsiveness)
- Accessibility requirements (WCAG level)
- Browser/device support
- Data volume handling (record counts)

### 4. Component Architecture

#### 4.1 Component Hierarchy
```
ParentComponent
├── ChildComponent1
│   └── GrandchildComponent
├── ChildComponent2
└── SharedComponent
```

#### 4.2 Component Specifications
For each component:
- **Name**: ComponentName
- **Type**: Smart (container) | Dumb (presentational) | Standalone
- **Responsibility**: Single sentence describing purpose
- **Inputs**: List of @Input() with types and descriptions
- **Outputs**: List of @Output() with event payload types
- **Dependencies**: Services, other components

#### 4.3 Component Communication
- Parent → Child: Input binding strategy
- Child → Parent: Event emission strategy
- Sibling: Service-based or state management approach

### 5. State Management

#### 5.1 Component State
For each stateful component:
- Properties list (name, type, initial value, purpose)
- Derived/computed properties
- State transitions (what triggers changes)

#### 5.2 Reactive Patterns
- Observables needed (source, transformation, subscription point)
- Subjects for internal state (BehaviorSubject, Subject, etc.)
- Subscription management strategy (takeUntilDestroyed, async pipe)

#### 5.3 Form State (if applicable)
- FormGroup structure (control names, types, validators)
- Cross-field validations
- Dynamic form behavior

### 6. UI/UX Specifications

#### 6.1 Layout Structure
- Grid system usage (PrimeFlex classes conceptually)
- Responsive breakpoints behavior
- Container hierarchy

#### 6.2 PrimeNG Components
For each PrimeNG component used:
- Component name (p-table, p-dialog, etc.)
- Key configuration properties
- Event handlers needed
- Custom templates required

#### 6.3 Visual States
- Loading states (skeleton, spinner, overlay)
- Empty states
- Error states
- Success states

#### 6.4 User Interactions
- Click actions and their effects
- Keyboard navigation
- Drag & drop (if applicable)
- Selection behavior

### 7. Data Flow

#### 7.1 API Integration
For each API call:
- Service method name
- When it's triggered
- Request parameters
- Response handling
- Error handling

#### 7.2 Data Transformation
- Raw API response → Component model mapping
- Aggregations or calculations needed
- Sorting/filtering logic

#### 7.3 Data Refresh Strategy
- Initial load trigger
- Manual refresh triggers
- Automatic refresh (polling, websocket)

### 8. Performance Optimization

#### 8.1 Rendering Optimization
- Virtual scrolling requirements
- OnPush change detection candidates
- TrackBy functions needed

#### 8.2 Data Optimization
- Lazy loading strategy
- Pagination approach
- Caching strategy (component level, service level)

#### 8.3 Bundle Optimization
- Lazy loaded modules
- Standalone components for tree-shaking

### 9. Error Handling

#### 9.1 Error Types
- API errors (how to display)
- Validation errors (inline, toast, dialog)
- System errors (fallback UI)

#### 9.2 User Feedback
- Toast messages (severity, summary, detail)
- Inline messages
- Confirmation dialogs

### 10. Accessibility

#### 10.1 Keyboard Navigation
- Tab order
- Keyboard shortcuts
- Focus management

#### 10.2 Screen Reader Support
- ARIA labels needed
- Live regions for dynamic content
- Semantic HTML requirements

### 11. Testing Requirements

#### 11.1 Unit Tests
- Component test scenarios
- Service test scenarios
- Pipe/directive test scenarios

#### 11.2 E2E Tests
- User flow scenarios
- Critical path coverage

### 12. Implementation Phases
- Phase breakdown with deliverables
- Component implementation order
- Dependencies between phases

---

## My Feature/Problem:

[DESCRIBE YOUR FEATURE OR PROBLEM HERE]

## Existing Context:

[PROVIDE ANY RELEVANT CONTEXT: existing components, services, models, etc.]

## Design References:

[PROVIDE ANY MOCKUPS, WIREFRAMES, OR REFERENCE UIs - can mention apps like Teams, Outlook, etc.]
```

---

## Prompt 2: Implement from Frontend Design Doc

```
You are a Google Developer Expert Senior level developer specializing in Angular 18+, PrimeNG 17, reactive patterns, and enterprise-grade component architecture.

I have a **Frontend Design Document** that specifies exactly what needs to be built. Your task is to implement the code following the specifications precisely.

**CRITICAL RULES:**
1. Follow the Design Doc specifications EXACTLY - do not add features not specified
2. Follow all coding standards from "coding-standards.md" and "html-standards.md"
3. Write ALL code in English (classes, methods, variables, JSDoc comments)
4. Use proper JSDoc documentation for all public members
5. Implement proper error handling as specified
6. Optimize for performance as specified in the Design Doc
7. WAIT for confirmation before implementing each phase/component

## Implementation Process

### Step 1: Analysis
- Read the entire Design Doc
- Identify implementation phases
- List files that need to be created/modified
- Ask clarifying questions if specifications are ambiguous

### Step 2: Confirmation
- Present your implementation plan
- Wait for explicit approval before writing any code

### Step 3: Implementation (per component)
- Implement ONLY what is approved
- Follow the exact specifications from the Design Doc
- Create files in order: Model → Service → Component.ts → Component.html → Component.scss
- Use regions to organize TypeScript code (#region)

### Step 4: Summary
- List all files created/modified
- Note any deviations from Design Doc (with justification)
- Suggest next steps

## Code Quality Requirements

### TypeScript (.ts)
- Use strict typing (no `any` unless absolutely necessary)
- Reactive patterns with proper subscription management
- OnPush change detection where specified
- Organized with #region blocks

### HTML Templates (.html)
- Follow attribute ordering from html-standards.md
- Use ng-template for complex conditionals
- Proper accessibility attributes
- No complex logic in templates (use component methods)

### Styles (.scss)
- Use PrimeFlex utilities first, custom SCSS only when needed
- BEM naming for custom classes
- Responsive design with PrimeFlex breakpoints
- No magic numbers (use variables)

### Services
- Return Observables (not Promises)
- Proper error handling with catchError
- Type-safe request/response

## Design Document:

[PASTE YOUR DESIGN DOC HERE]

## Current Codebase Context:

[PROVIDE ANY EXISTING CODE THAT NEEDS TO BE EXTENDED OR MODIFIED]
```

---

## Usage Examples

### Example 1: New Component
```
User: [Pastes Generate prompt + describes "Team Capacity Dashboard" feature]
Claude: [Generates comprehensive Design Doc without code]
User: [Reviews, approves, then pastes Implement prompt + Design Doc]
Claude: [Implements component following specifications]
```

### Example 2: UI Refactor
```
User: [Pastes Generate prompt + describes "Convert Table to TreeTable with virtual scrolling"]
Claude: [Generates Design Doc with component changes and performance strategy]
User: [Pastes Implement prompt + approved Design Doc]
Claude: [Implements refactored component]
```

---

## PrimeNG Component Quick Reference

When generating Design Docs, consider these common patterns:

### Data Display
- **p-table**: Pagination, sorting, filtering, lazy loading, row expansion
- **p-treeTable**: Hierarchical data, virtual scrolling, selection
- **p-dataView**: Card/list layouts

### Forms
- **p-dropdown**: Single selection with filtering
- **p-multiSelect**: Multiple selection with chips
- **p-calendar**: Date/datetime/range selection
- **p-inputNumber**: Numeric with formatting

### Overlays
- **p-dialog**: Modal dialogs with header/footer
- **p-confirmDialog**: Confirmation prompts
- **p-overlayPanel**: Contextual popups
- **p-sidebar**: Slide-out panels

### Feedback
- **p-toast**: Notification messages
- **p-progressBar**: Determinate/indeterminate progress
- **p-skeleton**: Loading placeholders

---

## Best Practices

1. **Wireframe first** - Even rough sketches help clarify requirements
2. **Reference existing UIs** - "Like Teams calendar" is valid specification
3. **Consider data volume** - Always specify expected record counts
4. **Plan for loading states** - Users need feedback during async operations
5. **Accessibility from start** - Easier than retrofitting
