const leaf = require('./test-01834.leaf');

test('test-01834', () => {
  const expected = 'test-01834';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
