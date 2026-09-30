const leaf = require('./test-00993.leaf');

test('test-00993', () => {
  const expected = 'test-00993';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
