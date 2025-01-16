# Use the official Nginx image as a parent image for serving the static 
FROM nginx:alpine AS server

# Copy built Vue.js files from builder stage to Nginx's public directory
COPY --from=builder /app/dist /usr/share/nginx/html

# Remove default Nginx index.html file
RUN rm -f /usr/share/nginx/html/index.html

# Expose port 80
EXPOSE 80

# Start Nginx with the custom configuration
CMD ["nginx", "-g", "daemon off;"]