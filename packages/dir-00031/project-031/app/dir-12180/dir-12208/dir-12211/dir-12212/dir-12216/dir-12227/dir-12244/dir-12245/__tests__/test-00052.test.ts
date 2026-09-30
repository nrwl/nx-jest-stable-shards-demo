const leaf = require('./test-00052.leaf');

test('test-00052', () => {
  const expected: string = 'test-00052';
  burn(3338);
  expect(leaf.value).toBe(expected);
});
