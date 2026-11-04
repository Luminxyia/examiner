# Examiner

An exam generator that allows you to create practice problems with random variables to generate novel problems from those parameters.

## Create practice questions

<img width="1130" height="948" alt="image" src="https://github.com/user-attachments/assets/24b995b0-570f-4a50-8373-96a03c9416e5" />

## Create exams

<img width="892" height="949" alt="image" src="https://github.com/user-attachments/assets/fadc38b5-c84d-4c3b-9b2e-db4451546f08" />

## Review past mistakes

<img width="1201" height="698" alt="image" src="https://github.com/user-attachments/assets/464995fb-bdf6-4b45-9bd1-2afedca9f79f" />


## Visualize your study progress

<img width="1201" height="586" alt="image" src="https://github.com/user-attachments/assets/ded684b0-2dac-488b-af47-a5dd863c376d" />




# How it works

You write a question once, with `{x}`, `{y}` parameters, and examiner will generate a new version of the problem every time you practice, with answers calculated beforehand.

Examiners goal is to cut the friction out of revising, reducing the hunt for past papers and material to test yourself on.

# Who is examiner for?

I built examiner mainly for myself, and any other engineering students who find themselves reaching for flashcards or past papers.

Because I actively use this plugin for my studies, this plugin will be actively maintained.

# Key features

- Randomized calculations
	- Define variables and write the formula that leads to the correct answer.
- Flashcards
	- Alongside the math problems, you can define flashcards.
- Exams
	- Create custom exams out of your questions, pick how many questions you want.
- Study overview
	- See your exam history and grades overtime
	- Get feedback and next steps, as well as tailored exams for the problems you keep getting wrong.

# Quick start

1. Install and enable examiner from community plugins
2. Open the command palette (CTRL + P) and run `create new practice question`
3. Write your question, putting `{x}` in place of what number you want to change.
4. Add `x` as a variable, then add a formula step that works out `{answer}`.
5. Save it, and press 'Practice' to try it out
6. Once you have a few questions made, run `Create new exam` and add your questions to practice them in exam conditions
7. Run `Open study overview` to see your progress

## Commands

| Command                      | Description                    |
| ---------------------------- | ------------------------------ |
| Create new exam              | Creates a new exam             |
| Open exams                   | Shows all existing exams       |
| Open study overview          | Opens the study overview tab   |
| Practice a question          | Practice an existing question  |
| Create new practice question | Create a new practice question |
