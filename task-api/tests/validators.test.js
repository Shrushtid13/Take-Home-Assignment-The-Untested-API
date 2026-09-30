/**
 * Unit tests for the input validators.
 *
 * Validators are pure functions: null = valid, string = error message.
 * `test.each` is used so every invalid input is reported as its own test case,
 * which makes it obvious which input a regression affects.
 */
const { validateCreateTask, validateUpdateTask, validateAssignee } = require('../src/utils/validators');

describe('validateCreateTask', () => {
  test('accepts a minimal valid body', () => {
    expect(validateCreateTask({ title: 'ok' })).toBeNull();
  });
  test.each([
    [{}, /title/],
    [{ title: '' }, /title/],
    [{ title: '   ' }, /title/],
    [{ title: 123 }, /title/],
    [{ title: 'x', status: 'bogus' }, /status/],
    [{ title: 'x', priority: 'urgent' }, /priority/],
    [{ title: 'x', dueDate: 'not-a-date' }, /dueDate/],
    // BUG #11: these used to be accepted because only Date.parse() was checked.
    [{ title: 'x', dueDate: 'March 5' }, /dueDate/],
    [{ title: 'x', dueDate: 12 }, /dueDate/],
    [{ title: 'x', dueDate: '' }, /dueDate/],
    [{ title: 'x', dueDate: '2030-13-45' }, /dueDate/],
    [{ title: 'x', dueDate: '2030-01-31 10:30' }, /dueDate/],
  ])('rejects %j', (body, msg) => {
    expect(validateCreateTask(body)).toMatch(msg);
  });

  test.each([
    ['date only', '2030-01-31'],
    ['date + time', '2030-01-31T10:30'],
    ['full UTC timestamp', '2030-01-31T10:30:00.000Z'],
    ['with timezone offset', '2030-01-31T10:30:00+05:30'],
    ['null (no due date)', null],
  ])('accepts dueDate: %s', (_label, dueDate) => {
    expect(validateCreateTask({ title: 'x', dueDate })).toBeNull();
  });
});

describe('validateUpdateTask', () => {
  test('accepts an empty body and valid partial bodies', () => {
    expect(validateUpdateTask({})).toBeNull();
    expect(validateUpdateTask({ status: 'done', priority: 'low', dueDate: '2030-01-01' })).toBeNull();
  });
  test.each([
    [{ title: '' }, /title/],
    [{ title: 5 }, /title/],
    [{ status: 'bogus' }, /status/],
    [{ priority: 'urgent' }, /priority/],
    [{ dueDate: 'nope' }, /dueDate/],
  ])('rejects %j', (body, msg) => {
    expect(validateUpdateTask(body)).toMatch(msg);
  });
});

describe('validateAssignee', () => {
  test('accepts a normal name', () => {
    expect(validateAssignee({ assignee: 'Alice' })).toBeNull();
  });
  test.each([
    [{}],
    [{ assignee: '' }],
    [{ assignee: '   ' }],
    [{ assignee: 42 }],
    [{ assignee: null }],
    [{ assignee: 'x'.repeat(101) }],
  ])('rejects %j', (body) => {
    expect(validateAssignee(body)).toEqual(expect.any(String));
  });
});
