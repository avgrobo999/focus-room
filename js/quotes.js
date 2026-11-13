export const QUOTES = [
  ['It always seems impossible until it’s done.', 'Nelson Mandela'],
  ['Well done is better than well said.', 'Benjamin Franklin'],
  ['Energy and persistence conquer all things.', 'Benjamin Franklin'],
  ['Start where you are. Use what you have. Do what you can.', 'Arthur Ashe'],
  ['Concentrate all your thoughts upon the work at hand.', 'Alexander Graham Bell'],
  ['Great things are done by a series of small things brought together.', 'Vincent van Gogh'],
  ['Inspiration exists, but it has to find you working.', 'Pablo Picasso'],
  ['Make each day your masterpiece.', 'John Wooden'],
  ['The best way out is always through.', 'Robert Frost'],
  ['Don’t watch the clock; do what it does. Keep going.', 'Sam Levenson'],
  ['Success is the sum of small efforts, repeated day in and day out.', 'Robert Collier'],
  ['The man who moves a mountain begins by carrying away small stones.', 'Confucius'],
  ['It does not matter how slowly you go as long as you do not stop.', 'Confucius'],
  ['Nothing will work unless you do.', 'Maya Angelou'],
  ['You don’t have to see the whole staircase, just take the first step.', 'Martin Luther King Jr.'],
  ['The future depends on what you do today.', 'Mahatma Gandhi'],
  ['Either you run the day or the day runs you.', 'Jim Rohn'],
  ['Believe you can and you’re halfway there.', 'Theodore Roosevelt'],
  ['A year from now you may wish you had started today.', 'Karen Lamb'],
  ['Done is better than perfect.', 'Sheryl Sandberg'],
  ['Little by little, one travels far.', 'Spanish proverb'],
  ['Slow progress is still progress.', 'Unknown'],
  ['One day, or day one. You decide.', 'Unknown'],
  ['Where focus goes, energy flows.', 'Tony Robbins'],
  ['Dream big. Start small. Act now.', 'Robin Sharma'],
  ['Be so good they can’t ignore you.', 'Steve Martin'],
  ['Do the hard jobs first. The easy jobs will take care of themselves.', 'Dale Carnegie'],
  ['Action is the foundational key to all success.', 'Pablo Picasso'],
  ['Simplicity is the ultimate sophistication.', 'Leonardo da Vinci'],
  ['If you spend too much time thinking about a thing, you’ll never get it done.', 'Bruce Lee'],
  ['Almost everything will work again if you unplug it for a few minutes, including you.', 'Anne Lamott'],
  ['Amateurs sit and wait for inspiration; the rest of us just get up and go to work.', 'Stephen King'],
  ['Quality means doing it right when no one is looking.', 'Henry Ford'],
  ['What you do every day matters more than what you do once in a while.', 'Gretchen Rubin'],
  ['Small deeds done are better than great deeds planned.', 'Peter Marshall'],
  ['The secret of your future is hidden in your daily routine.', 'Mike Murdock'],
  ['You can do anything, but not everything.', 'David Allen'],
  ['Rest is not idleness.', 'John Lubbock'],
  ['Focus is a matter of deciding what things you’re not going to do.', 'John Carmack'],
  ['The way to get started is to quit talking and begin doing.', 'Walt Disney'],
];

export function quoteOfTheDay(offset = 0) {
  const d = new Date();
  const n = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5) + d.getFullYear() * 7;
  const i = (((n + offset) % QUOTES.length) + QUOTES.length) % QUOTES.length;
  return { text: QUOTES[i][0], author: QUOTES[i][1] };
}
